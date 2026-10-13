/**
 * Low-volume Web Audio mixer for the cycling game. No microphone, audio files or external music
 * are required: the soundtrack and action sounds are synthesized after a user gesture.
 */
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'match' | 'shoot' | 'clear' | 'wrong'

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private musicTimer = 0
  private musicOn = false
  private buffers = new Map<string, AudioBuffer>()

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.music.gain.value = 0.2
    this.sfx.gain.value = 0.55
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
      case 'clear': [523, 659, 784].forEach((f, i) => tone(f, f * 1.015, 0.22, 'triangle', 0.16, i * 0.07)); break
      case 'wrong': tone(330, 294, 0.11, 'sine', 0.08); break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.3, 'triangle', 0.2, i * 0.11)); break
      case 'lose': [392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.28, 'sine', 0.1, i * 0.14)); break
    }
  }

  /** A gentle cycling motif over warm chords; scheduled only while the player enables sound. */
  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [246.9, 293.7, 369.9], [196, 246.9, 293.7]]
    const melody = [[523.3, 659.3, 587.3, 392], [440, 523.3, 659.3, 523.3], [493.9, 587.3, 739.9, 587.3], [392, 493.9, 587.3, 523.3]]
    let bar = 0
    const schedule = () => {
      if (!this.musicOn) return
      if (this.ctx.state !== 'running') {
        this.musicTimer = window.setTimeout(schedule, 250)
        return
      }
      const start = this.ctx.currentTime + 0.04
      const chord = chords[bar % chords.length]
      const tune = melody[bar % melody.length]
      chord.forEach(frequency => {
        const oscillator = this.ctx.createOscillator()
        const envelope = this.ctx.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency / 2
        envelope.gain.setValueAtTime(0.0001, start)
        envelope.gain.linearRampToValueAtTime(0.035, start + 0.45)
        envelope.gain.setValueAtTime(0.035, start + 1.9)
        envelope.gain.linearRampToValueAtTime(0.0001, start + 3.25)
        oscillator.connect(envelope).connect(this.music)
        oscillator.start(start)
        oscillator.stop(start + 3.3)
        const shimmer = this.ctx.createOscillator()
        const shimmerGain = this.ctx.createGain()
        shimmer.type = 'sine'
        shimmer.frequency.value = frequency
        shimmerGain.gain.setValueAtTime(0.0001, start)
        shimmerGain.gain.linearRampToValueAtTime(0.008, start + 0.7)
        shimmerGain.gain.linearRampToValueAtTime(0.0001, start + 3.1)
        shimmer.connect(shimmerGain).connect(this.music)
        shimmer.start(start)
        shimmer.stop(start + 3.2)
      })
      tune.forEach((frequency, index) => {
        const noteStart = start + index * 0.72
        const oscillator = this.ctx.createOscillator()
        const envelope = this.ctx.createGain()
        oscillator.type = 'triangle'
        oscillator.frequency.value = frequency
        envelope.gain.setValueAtTime(0.0001, noteStart)
        envelope.gain.linearRampToValueAtTime(0.028, noteStart + 0.025)
        envelope.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.43)
        oscillator.connect(envelope).connect(this.music)
        oscillator.start(noteStart)
        oscillator.stop(noteStart + 0.46)
      })
      bar += 1
      this.musicTimer = window.setTimeout(schedule, 3_500)
    }
    schedule()
  }

  stopMusic(): void {
    this.musicOn = false
    clearTimeout(this.musicTimer)
  }
}
