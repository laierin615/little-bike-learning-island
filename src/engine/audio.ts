/**
 * Low-volume Web Audio mixer for the cycling game. No microphone, audio files or external music
 * are required: the soundtrack and action sounds are synthesized after a user gesture.
 */
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'match' | 'shoot' | 'clear' | 'wrong'

export type MusicTheme = 'map' | 1 | 2 | 3 | 4 | 5

type Theme = { bpm: number; root: number; lead: 'marimba' | 'glock'; alternate: boolean; walk: boolean }
/** Map theme plus one flavour per world: 果園、森林、小鎮、山道. Roots are MIDI note numbers. */
const THEMES: Record<MusicTheme, Theme> = {
  map: { bpm: 116, root: 60, lead: 'marimba', alternate: true, walk: true },
  1: { bpm: 122, root: 65, lead: 'marimba', alternate: false, walk: true },
  2: { bpm: 104, root: 67, lead: 'glock', alternate: true, walk: false },
  3: { bpm: 126, root: 60, lead: 'marimba', alternate: true, walk: true },
  4: { bpm: 112, root: 62, lead: 'glock', alternate: true, walk: true },
  5: { bpm: 108, root: 64, lead: 'glock', alternate: true, walk: false },
}
/** I – vi – IV – V, as semitone offsets from the theme root. */
const PROGRESSION = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]]
/** Eighth-note melodies over four bars; -1 is a rest. */
const MELODY_A = [7, -1, 9, 7, 4, -1, 0, 2, 4, -1, 4, 7, 9, -1, 7, -1, 5, -1, 9, -1, 12, 9, 7, 5, 4, 2, 4, 7, 2, -1, -1, -1]
const MELODY_B = [12, -1, 11, 12, 9, -1, 7, -1, 9, 7, 4, 7, 12, -1, -1, -1, 9, -1, 5, 9, 12, -1, 14, 12, 11, -1, 7, -1, 11, 12, 14, -1]

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private musicTimer = 0
  private musicOn = false
  private buffers = new Map<string, AudioBuffer>()
  private duckGain: GainNode
  private theme: MusicTheme = 'map'
  private noise: AudioBuffer | null = null

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.music.gain.value = 0.2
    this.sfx.gain.value = 0.55
    this.duckGain = this.ctx.createGain()
    this.duckGain.connect(this.music)
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  get soundtrackRunning(): boolean {
    return this.musicOn
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volumes in 0..1. */
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : Math.max(0, Math.min(1, music)) * 0.34, t, 0.08)
    this.sfx.gain.setTargetAtTime(muted ? 0 : Math.max(0, Math.min(1, sfx)) * 0.55, t, 0.04)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    return buffer
  }

  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = loop
    src.connect(bus === 'music' ? this.music : this.sfx)
    src.start()
    return src
  }

  play(name: Sfx): void {
    if (this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const tone = (freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0) => {
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      o.type = type
      o.frequency.setValueAtTime(freq, t + delay)
      o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + delay + dur)
      g.gain.setValueAtTime(0.0001, t + delay)
      g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
      o.connect(g).connect(this.sfx)
      o.start(t + delay)
      o.stop(t + delay + dur + 0.05)
    }
    switch (name) {
      case 'pickup': tone(880, 1320, 0.12, 'triangle', 0.35); tone(1320, 1760, 0.16, 'sine', 0.25, 0.06); break
      case 'jump': tone(300, 620, 0.14, 'square', 0.12); break
      case 'land': tone(160, 70, 0.1, 'sine', 0.25); break
      case 'hurt': tone(220, 90, 0.28, 'sawtooth', 0.12); break
      case 'ui': tone(660, 700, 0.06, 'triangle', 0.15); break
      case 'dash': tone(500, 180, 0.18, 'sawtooth', 0.08); break
      case 'shoot': tone(420, 1040, 0.13, 'triangle', 0.18); tone(880, 1220, 0.09, 'sine', 0.13, 0.04); break
      case 'match': tone(659, 784, 0.12, 'sine', 0.18); tone(784, 988, 0.15, 'triangle', 0.15, 0.09); break
      case 'clear': [784, 988, 1175, 1568].forEach((f, i) => tone(f, f * 1.015, 0.24, 'sine', 0.16, i * 0.05)); tone(2637, 2640, 0.4, 'sine', 0.05, 0.2); break
      case 'wrong': tone(330, 294, 0.11, 'sine', 0.08); break
      case 'win': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, f * 1.01, i > 3 ? 0.6 : 0.24, i > 3 ? 'sine' : 'triangle', 0.2, i * 0.1)); tone(2093, 2100, 0.9, 'sine', 0.08, 0.62); break
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.28, 'sine', 0.1, i * 0.14)); break
    }
  }

  /** Switch the candy-town soundtrack: the map theme or one of the four world themes. */
  setMusicTheme(theme: MusicTheme): void {
    this.theme = theme
  }

  /** Lower the soundtrack while recorded narration plays so the voice stays clear. */
  duck(on: boolean): void {
    this.duckGain.gain.setTargetAtTime(on ? 0.35 : 1, this.ctx.currentTime, on ? 0.05 : 0.4)
  }

  /**
   * Bouncy candy-town soundtrack: marimba/glockenspiel lead, plucked bass, soft kick and shaker,
   * scheduled an eighth note at a time with a short look-ahead.
   */
  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    let step = 0
    let nextTime = 0
    const tick = () => {
      if (!this.musicOn) return
      if (this.ctx.state !== 'running') {
        this.musicTimer = window.setTimeout(tick, 250)
        return
      }
      if (nextTime < this.ctx.currentTime) nextTime = this.ctx.currentTime + 0.05
      while (nextTime < this.ctx.currentTime + 0.15) {
        this.scheduleStep(step, nextTime)
        nextTime += 60 / THEMES[this.theme].bpm / 2
        step = (step + 1) % 64
      }
      this.musicTimer = window.setTimeout(tick, 30)
    }
    tick()
  }

  private scheduleStep(step: number, time: number): void {
    const theme = THEMES[this.theme]
    const bar = Math.floor(step / 8) % 4
    const beat = step % 8
    const midi = (note: number) => 440 * 2 ** ((note - 69) / 12)
    const chord = PROGRESSION[bar].map(note => note + theme.root)
    const melody = (Math.floor(step / 32) === 1 && theme.alternate ? MELODY_B : MELODY_A)[step % 32]

    if (beat === 0) chord.forEach(note => this.note(midi(note + 12), time, 1.6, 'sine', 0.018, 0.5))
    if (beat === 0 || beat === 4) this.note(midi(chord[0] - 12 + (beat === 4 ? 7 : 0)), time, 0.32, 'triangle', 0.09, 0)
    if (beat === 6 && theme.walk) this.note(midi(chord[0] - 12 + 4), time, 0.2, 'triangle', 0.06, 0)
    if (beat === 0 || beat === 4) this.kick(time)
    if (beat % 2 === 1) this.shaker(time, beat === 3 || beat === 7 ? 0.05 : 0.025)
    if (melody >= 0) {
      const frequency = midi(theme.root + 12 + melody)
      if (theme.lead === 'marimba') {
        this.note(frequency, time, 0.35, 'sine', 0.11, 0)
        this.note(frequency * 4, time, 0.08, 'sine', 0.025, 0)
      } else {
        this.note(frequency * 2, time, 0.9, 'sine', 0.06, 0)
        this.note(frequency * 2 * 2.76, time, 0.25, 'sine', 0.015, 0)
      }
    }
  }

  private note(frequency: number, time: number, duration: number, type: OscillatorType, volume: number, attack: number): void {
    const oscillator = this.ctx.createOscillator()
    const envelope = this.ctx.createGain()
    oscillator.type = type
    oscillator.frequency.value = frequency
    envelope.gain.setValueAtTime(0.0001, time)
    envelope.gain.linearRampToValueAtTime(volume, time + Math.max(0.006, attack))
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.006, attack) + duration)
    oscillator.connect(envelope).connect(this.duckGain)
    oscillator.start(time)
    oscillator.stop(time + attack + duration + 0.05)
  }

  private kick(time: number): void {
    const oscillator = this.ctx.createOscillator()
    const envelope = this.ctx.createGain()
    oscillator.frequency.setValueAtTime(140, time)
    oscillator.frequency.exponentialRampToValueAtTime(50, time + 0.12)
    envelope.gain.setValueAtTime(0.12, time)
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
    oscillator.connect(envelope).connect(this.duckGain)
    oscillator.start(time)
    oscillator.stop(time + 0.2)
  }

  private shaker(time: number, volume: number): void {
    if (!this.noise) {
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    }
    const source = this.ctx.createBufferSource()
    source.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 6500
    const envelope = this.ctx.createGain()
    envelope.gain.setValueAtTime(volume, time)
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    source.connect(filter).connect(envelope).connect(this.duckGain)
    source.start(time)
    source.stop(time + 0.08)
  }

  stopMusic(): void {
    this.musicOn = false
    clearTimeout(this.musicTimer)
  }
}
