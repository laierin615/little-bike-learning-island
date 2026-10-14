import riderImage from '../../assets/images/bike-rider.png'
import type { Audio } from '../engine/audio'
import { LearningScene } from '../game/learning-scene'
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_WORLDS,
  getCampaignLevel,
  getModeLabel,
  shuffleChoices,
  type CampaignLevel,
} from '../game/campaign'
import {
  CAMPAIGN_PROGRESS_KEY,
  collapseAndRefillMatches,
  createMatchBoard,
  isLevelUnlocked,
  parseCampaignProgress,
  recordLevelStars,
  starsForMistakes,
  totalCampaignStars,
  tryMatchSwap,
  type CampaignProgress,
} from '../game/campaign-rules'
import { LearningUi } from './learning-ui'
import { Voice } from '../engine/voice'
import { FEEDBACK, bubbleCorrect, connectCorrect, levelComplete, levelGuide, memoryCorrect, roundSpeech, traceGood, traceStart } from '../game/speech-lines'
import { TRACE_GRID, TRACE_MIN_COVERAGE, scoreTrace } from '../game/trace-rules'

const VOICE_KEY = 'shuziyin.voice-guidance.v1'
const SOUND_KEY = 'shuziyin.sound-enabled.v1'
const TEACHER_KEY = 'shuziyin.teacher-unlock-all.v1'
const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const html = (text: string) => text.replace(/[&<>"']/g, character => ESCAPE[character])

type MemoryCard = { pairKey: string; label: string }
type Session = {
  levelId: number
  attempts: number
  mistakes: number
  correct: number
  roundIndex: number
  roundAnswered: boolean
  matchedPairs: string[]
  selectedLeft: string | null
  selectedRight: string | null
  rightOrder: string[]
  deck: MemoryCard[]
  flippedCards: number[]
  grid: string[]
  selectedCell: number | null
  matchesMade: number
  freshCells: number[]
  feedback: string
  /** Shuffled answer order for the current shoot/relay round. */
  choiceOrder: string[]
}
type CampaignView = 'map' | 'challenge' | 'complete' | 'practice'

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/**
 * Digits drawn the way children are taught to write them (not the printed glyph):
 * 1 is a single straight stroke; 9 is a round loop with a straight stem down its right side.
 */
function handwrittenPath(symbol: string, size: number): Path2D | null {
  const path = new Path2D()
  const at = (value: number) => value * size
  if (symbol === '1') {
    path.moveTo(at(0.5), at(0.18))
    path.lineTo(at(0.5), at(0.82))
    return path
  }
  if (symbol === '9') {
    path.moveTo(at(0.63), at(0.34))
    path.arc(at(0.48), at(0.34), at(0.15), 0, Math.PI * 2, true)
    path.moveTo(at(0.63), at(0.34))
    path.lineTo(at(0.61), at(0.82))
    return path
  }
  return null
}

export class CampaignUi {
  private readonly campaignRoot: HTMLDivElement
  private readonly practiceRoot: HTMLDivElement
  private readonly announcer: HTMLDivElement
  private practiceUi: LearningUi | null = null
  private view: CampaignView = 'map'
  private progress = this.readProgress()
  private soundEnabled = this.readSetting(SOUND_KEY, true)
  private voiceEnabled = this.readSetting(VOICE_KEY, true)
  private teacherUnlockAll = this.readSetting(TEACHER_KEY, false)
  private riding = false
  private skipRide: (() => void) | null = null
  private lastPlayedLevel = 0
  /** Finger strokes on the tracing canvas, in 0…1 canvas coordinates. */
  private traceStrokes: Array<Array<[number, number]>> = []
  private readonly speechSupported = typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined'
  private session: Session | null = null
  private completedLevelId = 0
  private memoryTimer: number | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly scene: LearningScene,
    private readonly audio: Audio,
  ) {
    this.campaignRoot = document.createElement('div')
    this.campaignRoot.className = 'campaign-root'
    this.practiceRoot = document.createElement('div')
    this.practiceRoot.className = 'practice-root'
    this.practiceRoot.hidden = true
    this.announcer = document.createElement('div')
    this.announcer.className = 'sr-only'
    this.announcer.setAttribute('aria-live', 'polite')
    this.announcer.setAttribute('aria-atomic', 'true')
    this.root.innerHTML = ''
    this.campaignRoot.append(this.announcer)
    this.root.append(this.campaignRoot, this.practiceRoot)
    this.campaignRoot.addEventListener('click', event => this.onClick(event))
    window.addEventListener('keydown', event => this.onKeyDown(event))
    this.audio.setVolumes(0.24, 0.65, !this.soundEnabled)
    this.renderMap()
  }

  get state(): { view: CampaignView; levelId: number | null; completedLevels: number; stars: number } {
    return {
      view: this.view,
      levelId: this.session?.levelId ?? (this.view === 'complete' ? this.completedLevelId : null),
      completedLevels: Object.keys(this.progress).length,
      stars: totalCampaignStars(this.progress),
    }
  }

  /** Teacher mode opens every level; otherwise levels unlock one by one. */
  private isUnlocked(id: number): boolean {
    return isLevelUnlocked(id, this.progress) || (this.teacherUnlockAll && id >= 1 && id <= CAMPAIGN_LEVELS.length)
  }

  private toggleTeacherUnlock(): void {
    this.teacherUnlockAll = !this.teacherUnlockAll
    this.saveSetting(TEACHER_KEY, this.teacherUnlockAll)
    this.audio.play('ui')
    this.renderMap()
    this.announcer.textContent = this.teacherUnlockAll ? `老師模式：${CAMPAIGN_LEVELS.length} 關全部開放。` : '已回到闖關模式：完成一關才會開下一關。'
  }

  private readProgress(): CampaignProgress {
    try {
      return parseCampaignProgress(localStorage.getItem(CAMPAIGN_PROGRESS_KEY))
    } catch {
      return {}
    }
  }

  private readSetting(key: string, fallback: boolean): boolean {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : stored === 'true'
    } catch {
      return fallback
    }
  }

  private saveSetting(key: string, value: boolean): void {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // The game remains playable when storage is unavailable.
    }
  }

  private writeProgress(): void {
    try {
      localStorage.setItem(CAMPAIGN_PROGRESS_KEY, JSON.stringify(this.progress))
    } catch {
      // Progress is kept for this visit even when browser storage is unavailable.
    }
  }

  private clearMemoryTimer(): void {
    if (this.memoryTimer !== null) window.clearTimeout(this.memoryTimer)
    this.memoryTimer = null
  }

  private setScreen(markup: string): void {
    this.campaignRoot.querySelector('.campaign-screen')?.remove()
    this.campaignRoot.insertAdjacentHTML('beforeend', markup)
  }

  private renderMap(): void {
    this.clearMemoryTimer()
    this.view = 'map'
    this.session = null
    this.campaignRoot.hidden = false
    this.practiceRoot.hidden = true
    this.scene.setActivity(null)
    this.audio.setMusicTheme('map')
    const completed = Object.keys(this.progress).length
    const stars = totalCampaignStars(this.progress)
    const next = Math.min(CAMPAIGN_LEVELS.length, Math.max(1, ...Object.keys(this.progress).map(Number).filter(Number.isFinite).map(id => id + 1)))

    this.setScreen(`<main class="campaign-screen map-screen">
      <header class="campaign-header map-header">
        <div class="campaign-brand"><span class="campaign-brand-mark" aria-hidden="true">🚴</span><div><p>小小單車學習島</p><small>${completed} / ${CAMPAIGN_LEVELS.length} 關完成</small></div></div>
        <div class="campaign-controls">${this.soundButtonMarkup()}${this.modeLabelMarkup()}<div class="campaign-stars" aria-label="共獲得 ${stars} 顆星">★ <strong>${stars}</strong><small> / ${CAMPAIGN_LEVELS.length * 3}</small></div></div>
      </header>
      <h1 id="campaign-title" class="sr-only">騎單車逛糖果小鎮，收集甜甜學習星</h1>
      <div class="campaign-map-scroll" role="region" aria-label="${CAMPAIGN_LEVELS.length} 關騎行地圖">
        ${this.roadMapMarkup(next, completed === CAMPAIGN_LEVELS.length)}
      </div>
      <footer class="campaign-footer"><span>沒有倒數，答錯也沒關係，騎到哪裡都能回來再玩！</span><div class="footer-actions"><button class="teacher-toggle" type="button" data-action="teacher-unlock" aria-pressed="${this.teacherUnlockAll}" aria-label="老師模式：${this.teacherUnlockAll ? '目前全部開放，按一下回到逐關解鎖' : `目前逐關解鎖，按一下開放全部 ${CAMPAIGN_LEVELS.length} 關`}">${this.teacherUnlockAll ? '🔓 全部開放中' : '🔒 老師：全開'}</button><button class="practice-entry" type="button" data-action="practice">自由練習　›</button></div></footer>
      <div class="sr-only" aria-live="polite">共有 ${CAMPAIGN_LEVELS.length} 關，已完成 ${completed} 關。選第一關開始騎行。</div>
    </main>`)

    const scroller = this.campaignRoot.querySelector<HTMLElement>('.campaign-map-scroll')
    const rider = this.campaignRoot.querySelector<HTMLElement>('.map-rider')
    if (scroller && rider) scroller.scrollTop = rider.offsetTop - scroller.clientHeight * 0.55
    // Coming back from a challenge: start on that level's spot and ride on to the next stop.
    const played = this.lastPlayedLevel
    this.lastPlayedLevel = 0
    const playedNode = played ? this.campaignRoot.querySelector<HTMLElement>(`[data-level="${played}"]`) : null
    if (playedNode && rider && Number(playedNode.dataset.roadTop) !== Number(rider.dataset.homeTop)) {
      this.rideTo(Number(rider.dataset.homeTop), () => {}, Number(playedNode.dataset.roadTop))
    }
  }

  /**
   * Rides the map rider along the candy road to the spot at `targetTop` (px from the map top),
   * scrolling the map with him, then calls `arrive`. Starts from his parking spot, or from the
   * road point at `fromTop` when given. Skips the ride for reduced-motion players.
   */
  private rideTo(targetTop: number, arrive: () => void, fromTop?: number): void {
    const map = this.campaignRoot.querySelector<HTMLElement>('.road-map')
    const path = map?.querySelector<SVGPathElement>('.road-surface')
    const rider = map?.querySelector<HTMLElement>('.map-rider')
    const scroller = this.campaignRoot.querySelector<HTMLElement>('.campaign-map-scroll')
    if (!map || !path || !rider || !scroller || matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(targetTop)) {
      arrive()
      return
    }
    const total = path.getTotalLength()
    // The road runs bottom → top, so y shrinks as the length grows.
    const lengthAt = (top: number) => {
      let low = 0
      let high = total
      while (high - low > 0.5) {
        const middle = (low + high) / 2
        if (path.getPointAtLength(middle).y > top) low = middle
        else high = middle
      }
      return (low + high) / 2
    }
    const place = (x: number, top: number, facingLeft: boolean) => {
      rider.style.setProperty('--x', x.toFixed(3))
      rider.style.top = `${top}px`
      rider.classList.toggle('is-facing-left', facingLeft)
      scroller.scrollTop = top - scroller.clientHeight * 0.55
    }
    const homeTop = Number(rider.dataset.homeTop)
    const parkedX = Number(rider.style.getPropertyValue('--x'))
    const parkedTop = parseFloat(rider.style.top)
    const startLength = lengthAt(fromTop ?? homeTop)
    const endLength = lengthAt(targetTop)
    const startPoint = path.getPointAtLength(startLength)
    const ridingHome = fromTop !== undefined
    const roadMs = Math.min(3200, Math.max(900, Math.abs(endLength - startLength) * 1.7))
    const hopMs = 260
    const began = performance.now()
    this.riding = true
    rider.classList.add('is-riding')
    let lastX = ridingHome ? startPoint.x : parkedX
    let done = false
    const finish = () => {
      if (done) return
      done = true
      this.riding = false
      this.skipRide = null
      rider.classList.remove('is-riding')
      if (ridingHome) place(parkedX, parkedTop, false)
      arrive()
    }
    this.skipRide = ridingHome ? finish : null
    const frame = (now: number) => {
      if (done) return
      const elapsed = now - began
      const leg1 = ridingHome ? 0 : hopMs
      if (elapsed < leg1) {
        const t = elapsed / leg1
        place(parkedX + (startPoint.x - parkedX) * t, parkedTop + (startPoint.y - parkedTop) * t, startPoint.x < parkedX)
      } else if (elapsed < leg1 + roadMs) {
        const t = (elapsed - leg1) / roadMs
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
        const point = path.getPointAtLength(startLength + (endLength - startLength) * eased)
        place(point.x, point.y, point.x < lastX - 0.002 || (Math.abs(point.x - lastX) <= 0.002 && rider.classList.contains('is-facing-left')))
        lastX = point.x
      } else if (ridingHome && elapsed < leg1 + roadMs + hopMs) {
        const t = (elapsed - leg1 - roadMs) / hopMs
        const end = path.getPointAtLength(endLength)
        place(end.x + (parkedX - end.x) * t, end.y + (parkedTop - end.y) * t, parkedX < end.x)
      } else {
        finish()
        return
      }
      requestAnimationFrame(frame)
    }
    if (ridingHome) place(startPoint.x, startPoint.y, false)
    requestAnimationFrame(frame)
  }

  /**
   * Candy-Crush-style scrolling road: level 1 at the bottom, the last level at the top.
   * Vertical positions are pixels from the bottom; horizontal positions are -1…1,
   * scaled by the CSS `--amp` so the SVG road and the round level buttons line up.
   */
  private roadMapMarkup(next: number, allDone: boolean): string {
    const STEP = 122
    const GAP = 104
    const BOTTOM = 200
    const TOP = 170
    const levelY = (id: number) => BOTTOM + (id - 1) * STEP + Math.floor((id - 1) / 6) * GAP
    const levelX = (id: number) => Math.round(Math.sin((id - 1) * 0.92) * 82) / 100
    const last = CAMPAIGN_LEVELS.length
    const height = levelY(last) + TOP
    const top = (fromBottom: number) => height - fromBottom
    const ribbonY = (world: number) => (world === 0 ? 118 : levelY(world * 6) + (STEP + GAP) / 2)
    const start = { x: 0, y: 30 }
    const finish = { x: 0, y: levelY(last) + 108 }

    const points = [start, ...CAMPAIGN_LEVELS.map(level => ({ x: levelX(level.id), y: levelY(level.id) })), finish]
    let road = `M ${points[0].x} ${top(points[0].y)}`
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]
      const to = points[index]
      const bend = (to.y - from.y) / 2
      road += ` C ${from.x} ${top(from.y + bend)} ${to.x} ${top(to.y - bend)} ${to.x} ${top(to.y)}`
    }

    const scenery = ['🍎🍊🍓🌳🍐🌼', '🌲🍄🌳🦋🌿🐞', '🏠🍭🏡🧁🍬🎪', '⛰️🌈🎈🌸🏔️⭐', '🌈🖍️✏️⭐☁️🎨'].map(set => Array.from(set.matchAll(/\p{Extended_Pictographic}️?/gu), match => match[0]))
    const zones = CAMPAIGN_WORLDS.map((world, index) => {
      const lower = index === 0 ? 0 : ribbonY(index) - 50
      const upper = index === CAMPAIGN_WORLDS.length - 1 ? height : ribbonY(index + 1) - 50
      const zoneTop = top(upper)
      const local = (fromBottom: number) => top(fromBottom) - zoneTop
      const worldCompleted = world.levels.filter(level => (this.progress[level.id] ?? 0) > 0).length

      const decorations = world.levels.flatMap(level => {
        const side = levelX(level.id) >= 0 ? -1 : 1
        const items = [{ x: side * (1.3 + ((level.id * 37) % 30) / 100), y: levelY(level.id) + ((level.id * 53) % 70) - 35, size: 34 + ((level.id * 13) % 16) }]
        if (Math.abs(levelX(level.id)) < 0.55) items.push({ x: -side * (1.4 + ((level.id * 29) % 25) / 100), y: levelY(level.id) + 40, size: 30 })
        for (const far of [-1, 1]) items.push({ x: far * (2.1 + ((level.id * (far > 0 ? 41 : 23)) % 70) / 100), y: levelY(level.id) + ((level.id * (far > 0 ? 31 : 47)) % 90) - 45, size: 40 + ((level.id * 11) % 22) })
        return items.map((item, offset) => `<span class="map-deco${Math.abs(item.x) > 1.9 ? ' deco-far' : ''}" style="--x:${item.x.toFixed(2)};top:${local(item.y)}px;font-size:${item.size}px">${scenery[index][(level.id * 7 + offset * 3) % scenery[index].length]}</span>`)
      }).join('')

      const nodes = world.levels.map(level => {
        const unlocked = this.isUnlocked(level.id)
        const earned = this.progress[level.id] ?? 0
        const state = !unlocked ? 'locked' : earned ? 'completed' : level.id === next ? 'ready' : 'ready is-open'
        const accessible = `第 ${level.id} 關，${level.title}，${getModeLabel(level.mode)}。${unlocked ? earned ? `已完成，${earned} 顆星。` : '可以開始。' : '完成前一關後開放。'}挑戰內容：${level.story}`
        return `<button class="campaign-node is-${state}" type="button" data-level="${level.id}" data-road-top="${top(levelY(level.id))}" style="--world-color:${world.color};--x:${levelX(level.id)};top:${local(levelY(level.id))}px" aria-label="${html(accessible)}" ${unlocked ? '' : 'disabled'}>
          <span class="node-number">${level.id}</span>
          <span class="node-bike" aria-hidden="true">${!unlocked ? '🔒' : earned ? '🏁' : level.id === next ? '⭐' : '🚴'}</span>
          <span class="node-title">${html(level.title)}</span>
          <span class="node-stars" aria-label="${earned} 顆星">${earned ? '★'.repeat(earned) + '☆'.repeat(3 - earned) : '☆☆☆'}</span>
        </button>`
      }).join('')

      return `<section class="world-card road-zone road-zone-${world.id}" style="--world-color:${world.color};top:${zoneTop}px;height:${upper - lower}px" aria-labelledby="world-${world.id}">
        <div class="zone-ribbon" style="top:${local(ribbonY(index))}px"><span aria-hidden="true">${world.icon}</span><h2 id="world-${world.id}">${html(world.name)}</h2><small>${worldCompleted} / 6</small></div>
        <div aria-hidden="true">${decorations}</div>
        <div role="group" aria-label="${html(world.name)}六個關卡">${nodes}</div>
      </section>`
    }).join('')

    // The rider waits beside the current challenge, on the side facing the middle of the map.
    const target = allDone ? finish : { x: levelX(next), y: levelY(next) }
    const rider = { x: target.x + (target.x > 0.05 ? -0.86 : 0.86), y: target.y - 42 }

    return `<div class="road-map" style="height:${height}px">
      <svg class="road-svg" viewBox="-1 0 2 ${height}" preserveAspectRatio="none" aria-hidden="true">
        <path class="road-edge" d="${road}" /><path class="road-surface" d="${road}" /><path class="road-dash" d="${road}" />
      </svg>
      ${zones}
      <div class="map-landmark map-finish" style="--x:0;top:${top(finish.y)}px" aria-hidden="true"><span>🏰</span><strong>大終點</strong></div>
      <div class="map-landmark map-start" style="--x:0;top:${top(start.y + 20)}px" aria-hidden="true"><strong>出發！</strong></div>
      <img class="map-rider" src="${riderImage}" alt="" data-home-top="${top(target.y)}" style="--x:${rider.x.toFixed(2)};top:${top(rider.y)}px" />
    </div>`
  }

  private enterPractice(): void {
    this.view = 'practice'
    this.campaignRoot.hidden = true
    this.practiceRoot.hidden = false
    if (!this.practiceUi) {
      this.practiceUi = new LearningUi(this.practiceRoot, this.scene, this.audio, () => this.renderMap())
    }
  }

  private startLevel(id: number): void {
    if (!this.isUnlocked(id)) return
    this.clearMemoryTimer()
    const level = getCampaignLevel(id)
    this.lastPlayedLevel = id
    this.audio.setMusicTheme(level.world as 1 | 2 | 3 | 4 | 5)
    this.completedLevelId = 0
    this.view = 'challenge'
    this.session = {
      levelId: id,
      attempts: 0,
      mistakes: 0,
      correct: 0,
      roundIndex: 0,
      roundAnswered: false,
      matchedPairs: [],
      selectedLeft: null,
      selectedRight: null,
      rightOrder: shuffled(level.pairs.map(pair => pair.key)),
      deck: shuffled(level.pairs.flatMap(pair => [
        { pairKey: pair.key, label: pair.left },
        { pairKey: pair.key, label: pair.right },
      ])),
      flippedCards: [],
      grid: level.mode === 'match3' ? createMatchBoard(level.matchSymbols) : [],
      selectedCell: null,
      matchesMade: 0,
      freshCells: [],
      feedback: '',
      choiceOrder: level.rounds[0] ? shuffleChoices(level.rounds[0].choices) : [],
    }
    this.traceStrokes = []
    this.scene.setActivity(level.topic === 'mixed' ? null : level.topic)
    void this.audio.unlock()
    this.applySound()
    if (this.soundEnabled) {
      this.audio.startMusic()
      this.audio.play('ui')
    }
    this.renderChallenge()
    this.announcer.textContent = `${level.worldName}，第 ${level.id} 關，${level.title}。${level.challenge}`
    this.speakLevelGuide(level, this.currentPromptSpeech(level))
  }

  /** What to read after the level guide: the current question, or the symbol to trace. */
  private currentPromptSpeech(level: CampaignLevel): string {
    if (!this.session) return ''
    if (level.mode === 'shoot' || level.mode === 'relay') return roundSpeech(level.rounds[this.session.roundIndex], this.session.choiceOrder)
    if (level.mode === 'trace') return traceStart(level, level.traceSymbols[this.session.roundIndex])
    return ''
  }

  private applySound(): void {
    this.audio.setVolumes(0.24, 0.65, !this.soundEnabled)
    if (this.soundEnabled) this.audio.startMusic()
    else this.audio.stopMusic()
  }

  private renderChallenge(): void {
    if (!this.session) return
    const level = getCampaignLevel(this.session.levelId)
    const body = level.mode === 'connect'
      ? this.connectMarkup(level, this.session)
      : level.mode === 'memory'
        ? this.memoryMarkup(level, this.session)
        : level.mode === 'match3'
          ? this.match3Markup(level, this.session)
          : level.mode === 'trace'
            ? this.traceMarkup(level, this.session)
            : this.roundMarkup(level, this.session)
    const progress = this.modeProgress(level, this.session)
    this.setScreen(`<main class="campaign-screen play-screen" data-level-id="${level.id}" data-campaign-mode="${level.mode}" style="--world-color:${level.color}">
      <header class="campaign-header play-header">
        <button class="map-back" type="button" data-action="back-map" aria-label="回到關卡地圖">‹ 地圖</button>
        <div class="play-location"><span>第 ${level.id} 關</span><small>${html(level.worldName)}・${getModeLabel(level.mode)}</small></div>
        <div class="campaign-controls">${this.soundButtonMarkup()}${this.modeLabelMarkup()}</div>
      </header>
      <section class="challenge-heading"><div><p class="campaign-kicker">${html(level.worldName)}・第 ${level.id} 站</p><h1>${html(level.title)}</h1><p class="challenge-story">${html(level.story)}</p></div><div class="challenge-howto"><span aria-hidden="true">🚴</span><p>${html(level.challenge)}</p><button type="button" data-action="replay-guide" aria-label="重聽這一關的挑戰說明">🔊<small>重聽</small></button></div></section>
      <div class="challenge-progress" role="progressbar" aria-label="本關挑戰進度" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.current}"><i style="width:${Math.round((progress.current / progress.total) * 100)}%"></i><span>${progress.label}</span></div>
      <section class="challenge-board" aria-label="${getModeLabel(level.mode)}遊戲區">${body}</section>
      <p class="campaign-feedback" aria-live="polite">${html(this.session.feedback || '慢慢觀察，找到好走的下一步。')}</p>
      ${this.roundContinueMarkup(level, this.session)}
      <p class="campaign-gentle-hint">沒有計時；答錯也能再試，騎到終點就有星星。</p>
      <div class="sr-only" aria-live="polite">${html(this.session.feedback)}</div>
    </main>`)
    if (level.mode === 'trace') this.setupTraceCanvas(level)
  }

  private modeProgress(level: CampaignLevel, session: Session): { current: number; total: number; label: string } {
    if (level.mode === 'connect' || level.mode === 'memory') {
      return { current: session.matchedPairs.length, total: level.pairs.length, label: `${session.matchedPairs.length} / ${level.pairs.length} 組好朋友` }
    }
    if (level.mode === 'match3') {
      return { current: Math.min(session.matchesMade, level.matchTarget), total: level.matchTarget, label: `${Math.min(session.matchesMade, level.matchTarget)} / ${level.matchTarget} 次消除` }
    }
    if (level.mode === 'trace') {
      return { current: session.correct, total: level.traceSymbols.length, label: `${session.correct} / ${level.traceSymbols.length} 個符號描好了` }
    }
    return { current: session.correct, total: level.rounds.length, label: `${session.correct} / ${level.rounds.length} 題補給` }
  }

  private connectMarkup(level: CampaignLevel, session: Session): string {
    const left = level.pairs.map(pair => `<button class="pair-card ${session.selectedLeft === pair.key ? 'is-selected' : ''} ${session.matchedPairs.includes(pair.key) ? 'is-matched' : ''}" type="button" data-pair-side="left" data-pair-key="${pair.key}" ${session.matchedPairs.includes(pair.key) ? 'disabled' : ''} aria-pressed="${session.selectedLeft === pair.key}"><span>${html(pair.left)}</span></button>`).join('')
    const right = session.rightOrder.map(key => {
      const pair = level.pairs.find(candidate => candidate.key === key)!
      return `<button class="pair-card ${session.selectedRight === key ? 'is-selected' : ''} ${session.matchedPairs.includes(key) ? 'is-matched' : ''}" type="button" data-pair-side="right" data-pair-key="${key}" ${session.matchedPairs.includes(key) ? 'disabled' : ''} aria-pressed="${session.selectedRight === key}"><span>${html(pair.right)}</span></button>`
    }).join('')
    return `<div class="mode-instructions"><span class="mode-icon" aria-hidden="true">🔗</span><div><strong>連連看</strong><small>先點左邊，再點右邊的好朋友。</small></div></div><div class="pair-board"><section class="pair-column" aria-label="圖片或數量">${left}</section><span class="pair-bridge" aria-hidden="true">⤷</span><section class="pair-column" aria-label="學習符號">${right}</section></div>`
  }

  private memoryMarkup(level: CampaignLevel, session: Session): string {
    const cards = session.deck.map((card, index) => {
      const shown = session.flippedCards.includes(index) || session.matchedPairs.includes(card.pairKey)
      const matched = session.matchedPairs.includes(card.pairKey)
      return `<button class="memory-card ${shown ? 'is-open' : ''} ${matched ? 'is-matched' : ''}" type="button" data-memory-card="${index}" data-pair-key="${html(card.pairKey)}" ${matched || session.flippedCards.length >= 2 ? 'disabled' : ''} aria-label="${shown ? html(card.label) : '記憶卡，點開看看'}" aria-pressed="${shown}"><span>${shown ? html(card.label) : '✦'}</span></button>`
    }).join('')
    return `<div class="mode-instructions"><span class="mode-icon" aria-hidden="true">🃏</span><div><strong>翻牌記憶配對</strong><small>一次翻兩張，記住圖片和符號的位置。</small></div></div><div class="memory-board" role="group" aria-label="${level.pairs.length * 2} 張記憶卡">${cards}</div>`
  }

  private roundMarkup(level: CampaignLevel, session: Session): string {
    const round = level.rounds[session.roundIndex]
    const options = session.choiceOrder.map((choice, index) => `<button class="target-option ${session.roundAnswered && choice === round.answer ? 'is-correct' : ''}" type="button" data-round-choice="${html(choice)}" ${session.roundAnswered ? 'disabled' : ''} aria-label="選擇 ${html(choice)}，第 ${index + 1} 個目標"><span class="target-bubble" aria-hidden="true">${html(choice)}</span><small>泡泡 ${index + 1}</small></button>`).join('')
    const icon = level.mode === 'shoot' ? '🎯' : '🏁'
    const label = level.mode === 'shoot' ? '泡泡射擊' : '接力挑戰'
    return `<div class="mode-instructions"><span class="mode-icon" aria-hidden="true">${icon}</span><div><strong>${label}</strong><small>看圖和題目，點一下正確的泡泡目標。</small></div><span class="round-number">${session.roundIndex + 1} / ${level.rounds.length}</span></div><div class="round-prompt"><div class="round-picture" role="img" aria-label="${html(round.pictureLabel)}">${html(round.picture)}</div><h2>${html(round.prompt)}</h2><p>選一個答案；答錯沒有關係。</p></div><div class="target-row" role="group" aria-label="選擇正確目標">${options}</div>`
  }

  private match3Markup(level: CampaignLevel, session: Session): string {
    const tiles = session.grid.map((symbol, index) => `<button class="match-tile ${session.selectedCell === index ? 'is-selected' : ''} ${session.freshCells.includes(index) ? 'is-fresh' : ''}" type="button" role="gridcell" data-match-cell="${index}" data-candy="${level.matchSymbols.indexOf(symbol) % 6}" aria-label="第 ${Math.floor(index / 5) + 1} 排第 ${index % 5 + 1} 格，${html(symbol)}" aria-pressed="${session.selectedCell === index}">${html(symbol)}</button>`).join('')
    return `<div class="mode-instructions"><span class="mode-icon" aria-hidden="true">🚲</span><div><strong>車輪消消樂</strong><small>先點一塊，再點旁邊圖塊交換位置。</small></div><span class="match-symbols">${level.matchSymbols.map(html).join('　')}</span></div><p class="match-instruction">把三個相同符號排在同一列或同一行，就能收下一顆星。</p><div class="match-grid" role="grid" aria-label="5 乘 5 消消樂棋盤">${tiles}</div>`
  }

  private roundContinueMarkup(level: CampaignLevel, session: Session): string {
    if ((level.mode !== 'shoot' && level.mode !== 'relay') || !session.roundAnswered) return ''
    const isLast = session.roundIndex + 1 >= level.rounds.length
    return `<button class="campaign-primary" type="button" data-action="advance-round">${isLast ? '補給完成，騎到終點　🏁' : '下一站　›'}</button>`
  }

  private modeLabelMarkup(): string {
    const active = this.speechSupported && this.voiceEnabled
    const speechTitle = this.speechSupported
      ? (active ? '語音引導已開啟，按一下關閉' : '語音引導已關閉，按一下開啟')
      : '此瀏覽器不支援語音合成，仍可看文字遊玩'
    return `<button class="media-button voice-control" type="button" data-action="voice-toggle" ${this.speechSupported ? '' : 'disabled'} aria-pressed="${active}" aria-label="繁體中文語音引導" title="${speechTitle}"><span aria-hidden="true">${active ? '🔊' : '🔇'}</span><small>語音</small></button>`
  }

  private soundButtonMarkup(): string {
    const title = this.soundEnabled ? '配樂與音效已開啟，按一下靜音' : '配樂與音效已關閉，按一下開啟'
    return `<button class="media-button sound-control" type="button" data-action="sound-toggle" aria-pressed="${this.soundEnabled}" aria-label="配樂與音效" title="${title}"><span aria-hidden="true">${this.soundEnabled ? '🎵' : '🔇'}</span><small>聲音</small></button>`
  }

  private renderComplete(): void {
    const level = getCampaignLevel(this.completedLevelId)
    const stars = this.progress[level.id] ?? 1
    const nextId = level.id + 1
    const hasNext = nextId <= CAMPAIGN_LEVELS.length
    const nextUnlocked = hasNext && this.isUnlocked(nextId)
    this.setScreen(`<main class="campaign-screen result-screen" style="--world-color:${level.color}"><section class="result-card" aria-labelledby="result-title"><div class="result-decoration" aria-hidden="true">✦　🚴　✦</div><span class="result-bike" aria-hidden="true">🏁</span><p class="campaign-kicker">${html(level.worldName)}・第 ${level.id} 關</p><h1 id="result-title">${level.id === CAMPAIGN_LEVELS.length ? '騎到大終點！' : '太棒了！'}</h1><p class="result-copy">完成「${html(level.title)}」，又學會一個新本領。</p><div class="result-stars" aria-label="本關獲得 ${stars} 顆星">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div><p class="result-unlock">${hasNext ? `下一站「${html(getCampaignLevel(nextId).title)}」已開放。` : `${CAMPAIGN_LEVELS.length} 關全部完成！你是單車學習小高手。`}</p>${nextUnlocked ? '<button class="campaign-primary" type="button" data-action="next-level">騎往下一關　›</button>' : ''}<button class="secondary-button" type="button" data-action="replay-level">再玩這一關</button><button class="text-button" type="button" data-action="back-map">回到關卡地圖</button></section></main>`)
  }

  private traceMarkup(level: CampaignLevel, session: Session): string {
    const symbol = level.traceSymbols[session.roundIndex]
    const kind = level.topic === 'numbers' ? '數字' : '注音'
    return `<div class="mode-instructions"><span class="mode-icon" aria-hidden="true">✏️</span><div><strong>描寫${kind}</strong><small>用手指沿著虛線描，描完按「寫好了」。</small></div><span class="round-number">${session.roundIndex + 1} / ${level.traceSymbols.length}</span></div>
      <div class="trace-stage"><canvas class="trace-canvas" data-trace-symbol="${html(symbol)}" role="img" aria-label="描寫${kind} ${html(symbol)} 的畫布，用手指沿著虛線描"></canvas></div>
      <div class="trace-actions"><button class="secondary-button" type="button" data-action="trace-clear">擦掉重寫</button><button class="campaign-primary" type="button" data-action="trace-check">寫好了　✓</button></div>`
  }

  /** Draws the fat symbol track (and its dashed outline when `guide`) centred in a size×size box. */
  private drawTraceTrack(context: CanvasRenderingContext2D, size: number, symbol: string, color: string, guide: boolean): void {
    context.save()
    const hand = handwrittenPath(symbol, size)
    if (hand) {
      // Handwritten shapes: a fat track to trace in, with a dashed centre line showing the stroke.
      context.lineJoin = 'round'
      context.lineCap = 'round'
      context.strokeStyle = color
      context.lineWidth = size * 0.17
      if (guide) context.globalAlpha = 0.24
      context.stroke(hand)
      if (guide) {
        context.globalAlpha = 0.95
        context.setLineDash([size * 0.03, size * 0.026])
        context.lineWidth = Math.max(3, size * 0.014)
        context.stroke(hand)
      }
      context.restore()
      return
    }
    context.font = `900 ${Math.round(size * 0.72)}px "ManusCC0", "ManusCC0 Sans CJK SC", "Noto Sans TC", sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    const metrics = context.measureText(symbol)
    const y = size / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.lineWidth = size * 0.1
    context.strokeStyle = color
    context.fillStyle = color
    if (guide) context.globalAlpha = 0.24
    context.strokeText(symbol, size / 2, y)
    context.fillText(symbol, size / 2, y)
    if (guide) {
      context.globalAlpha = 0.95
      context.setLineDash([size * 0.028, size * 0.024])
      context.lineWidth = Math.max(2, size * 0.009)
      context.strokeStyle = color
      context.strokeText(symbol, size / 2, y)
    }
    context.restore()
  }

  private setupTraceCanvas(level: CampaignLevel): void {
    const canvas = this.campaignRoot.querySelector<HTMLCanvasElement>('.trace-canvas')
    const session = this.session
    const context = canvas?.getContext('2d')
    if (!canvas || !session || !context) return
    const symbol = level.traceSymbols[session.roundIndex]
    const size = canvas.clientWidth || 280
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * ratio)
    canvas.height = Math.round(size * ratio)
    context.scale(ratio, ratio)
    const inkWidth = size * 0.075
    const redraw = () => {
      context.clearRect(0, 0, size, size)
      // 田字格 guide lines.
      context.save()
      context.strokeStyle = '#f6c9dc'
      context.lineWidth = 2
      context.setLineDash([8, 8])
      context.beginPath()
      context.moveTo(size / 2, 10)
      context.lineTo(size / 2, size - 10)
      context.moveTo(10, size / 2)
      context.lineTo(size - 10, size / 2)
      context.stroke()
      context.restore()
      this.drawTraceTrack(context, size, symbol, level.color, true)
      context.save()
      context.strokeStyle = '#ff3f7f'
      context.lineWidth = inkWidth
      context.lineCap = 'round'
      context.lineJoin = 'round'
      for (const stroke of this.traceStrokes) {
        context.beginPath()
        stroke.forEach(([x, y], index) => (index === 0 ? context.moveTo(x * size, y * size) : context.lineTo(x * size, y * size)))
        if (stroke.length === 1) context.lineTo(stroke[0][0] * size + 0.1, stroke[0][1] * size)
        context.stroke()
      }
      context.restore()
    }
    redraw()
    const point = (event: PointerEvent): [number, number] => {
      const box = canvas.getBoundingClientRect()
      return [Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))]
    }
    let drawing = false
    canvas.addEventListener('pointerdown', event => {
      event.preventDefault()
      drawing = true
      canvas.setPointerCapture(event.pointerId)
      this.traceStrokes.push([point(event)])
      redraw()
    })
    canvas.addEventListener('pointermove', event => {
      if (!drawing) return
      this.traceStrokes[this.traceStrokes.length - 1]?.push(point(event))
      redraw()
    })
    const stop = () => { drawing = false }
    canvas.addEventListener('pointerup', stop)
    canvas.addEventListener('pointercancel', stop)
  }

  private clearTrace(): void {
    this.traceStrokes = []
    this.audio.play('ui')
    if (this.session) this.session.feedback = ''
    this.renderChallenge()
  }

  /** Rasterises the track and the ink onto the scoring grid and checks the trace. */
  private checkTrace(): void {
    if (!this.session || this.view !== 'challenge') return
    const level = getCampaignLevel(this.session.levelId)
    const symbol = level.traceSymbols[this.session.roundIndex]
    if (this.traceStrokes.length === 0) {
      this.session.feedback = FEEDBACK.traceEmpty
      this.speak(this.session.feedback)
      this.renderChallenge()
      return
    }
    const grid = document.createElement('canvas')
    grid.width = TRACE_GRID
    grid.height = TRACE_GRID
    const context = grid.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const read = () => {
      const pixels = context.getImageData(0, 0, TRACE_GRID, TRACE_GRID).data
      const mask = new Uint8Array(TRACE_GRID * TRACE_GRID)
      for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4 + 3] > 60 ? 1 : 0
      return mask
    }
    this.drawTraceTrack(context, TRACE_GRID, symbol, '#000', false)
    const target = read()
    context.clearRect(0, 0, TRACE_GRID, TRACE_GRID)
    context.strokeStyle = '#000'
    context.lineWidth = TRACE_GRID * 0.075
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const stroke of this.traceStrokes) {
      context.beginPath()
      stroke.forEach(([x, y], index) => (index === 0 ? context.moveTo(x * TRACE_GRID, y * TRACE_GRID) : context.lineTo(x * TRACE_GRID, y * TRACE_GRID)))
      if (stroke.length === 1) context.lineTo(stroke[0][0] * TRACE_GRID + 0.1, stroke[0][1] * TRACE_GRID)
      context.stroke()
    }
    const score = scoreTrace(target, read())
    this.session.attempts += 1
    if (!score.passed) {
      this.session.mistakes += 1
      this.session.feedback = score.coverage < TRACE_MIN_COVERAGE ? FEEDBACK.traceMore : FEEDBACK.traceOff
      this.audio.play('wrong')
      this.speak(this.session.feedback)
      this.renderChallenge()
      return
    }
    this.session.correct += 1
    this.traceStrokes = []
    this.scene.advanceRider()
    this.audio.play('clear')
    const praise = traceGood(level, symbol)
    if (this.session.roundIndex + 1 >= level.traceSymbols.length) {
      this.session.feedback = praise
      this.renderChallenge()
      this.speak(praise)
      this.clearMemoryTimer()
      this.memoryTimer = window.setTimeout(() => this.finishLevel(), 1100)
      return
    }
    this.session.roundIndex += 1
    this.session.feedback = praise
    this.renderChallenge()
    this.speak(`${praise}${traceStart(level, level.traceSymbols[this.session.roundIndex])}`)
  }

  private finishLevel(): void {
    if (!this.session) return
    this.clearMemoryTimer()
    const levelId = this.session.levelId
    const stars = starsForMistakes(this.session.mistakes)
    this.progress = recordLevelStars(this.progress, levelId, stars)
    this.writeProgress()
    this.completedLevelId = levelId
    this.session = null
    this.view = 'complete'
    this.audio.play('win')
    this.renderComplete()
    const level = getCampaignLevel(levelId)
    this.announcer.textContent = `太棒了！完成「${level.title}」，獲得 ${this.progress[levelId]} 顆星。下一關已開放。`
    this.speak(levelComplete(level, this.progress[levelId] ?? 1))
  }

  private onClick(event: MouseEvent): void {
    if (this.riding) {
      // A tap during the ride home finishes it at once; a ride into a level can't be interrupted.
      if (!this.skipRide) return
      this.skipRide()
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!button || button.disabled) return
    if (button.dataset.level) {
      const id = Number(button.dataset.level)
      if (this.view === 'map') this.rideTo(Number(button.dataset.roadTop), () => this.startLevel(id))
      else this.startLevel(id)
      return
    }
    const action = button.dataset.action
    if (action === 'practice') this.enterPractice()
    else if (action === 'back-map') this.renderMap()
    else if (action === 'next-level') this.startLevel(this.completedLevelId + 1)
    else if (action === 'replay-level') this.startLevel(this.completedLevelId)
    else if (action === 'replay-guide' && this.session) {
      const level = getCampaignLevel(this.session.levelId)
      this.speakLevelGuide(level, this.currentPromptSpeech(level))
    }
    else if (action === 'advance-round') this.advanceRound()
    else if (action === 'sound-toggle') this.toggleSound()
    else if (action === 'voice-toggle') this.toggleVoice()
    else if (action === 'teacher-unlock') this.toggleTeacherUnlock()
    else if (action === 'trace-clear') this.clearTrace()
    else if (action === 'trace-check') this.checkTrace()
    else if (button.dataset.pairSide && button.dataset.pairKey) this.selectPair(button.dataset.pairSide, button.dataset.pairKey)
    else if (button.dataset.memoryCard !== undefined) this.flipMemoryCard(Number(button.dataset.memoryCard))
    else if (button.dataset.roundChoice) this.answerRound(button.dataset.roundChoice)
    else if (button.dataset.matchCell !== undefined) this.selectMatchCell(Number(button.dataset.matchCell))
  }

  private selectPair(side: string, key: string): void {
    if (!this.session || this.view !== 'challenge') return
    if (side === 'left') this.session.selectedLeft = key
    else if (side === 'right') this.session.selectedRight = key
    if (this.session.selectedLeft && this.session.selectedRight) {
      this.session.attempts += 1
      if (this.session.selectedLeft === this.session.selectedRight) {
        const level = getCampaignLevel(this.session.levelId)
        const pair = level.pairs.find(candidate => candidate.key === key)!
        this.session.matchedPairs.push(key)
        this.session.correct += 1
        this.session.feedback = connectCorrect(pair)
        this.scene.advanceRider()
        this.audio.play('match')
        this.speak(connectCorrect(pair))
        const done = this.session.matchedPairs.length >= level.pairs.length
        if (done) {
          this.finishLevel()
          return
        }
      } else {
        this.session.mistakes += 1
        this.session.feedback = FEEDBACK.connectWrong
        this.audio.play('wrong')
        this.speak(this.session.feedback)
      }
      this.session.selectedLeft = null
      this.session.selectedRight = null
    }
    this.renderChallenge()
  }

  private flipMemoryCard(index: number): void {
    if (!this.session || this.view !== 'challenge' || this.session.flippedCards.length >= 2) return
    const card = this.session.deck[index]
    if (!card || this.session.matchedPairs.includes(card.pairKey) || this.session.flippedCards.includes(index)) return
    if (!this.session.flippedCards.length) {
      this.session.flippedCards = [index]
      this.audio.play('ui')
      this.renderChallenge()
      return
    }

    const firstIndex = this.session.flippedCards[0]
    const firstCard = this.session.deck[firstIndex]
    this.session.attempts += 1
    if (firstCard.pairKey === card.pairKey) {
      this.session.matchedPairs.push(card.pairKey)
      this.session.flippedCards = []
      const level = getCampaignLevel(this.session.levelId)
      const pair = level.pairs.find(candidate => candidate.key === card.pairKey)!
      this.session.feedback = `記住了！${pair.learningNote}`
      this.session.correct += 1
      this.scene.advanceRider()
      this.audio.play('match')
      this.speak(memoryCorrect(pair))
      if (this.session.matchedPairs.length >= level.pairs.length) {
        this.finishLevel()
        return
      }
    } else {
      this.session.flippedCards = [firstIndex, index]
      this.session.mistakes += 1
      this.session.feedback = FEEDBACK.memoryWrong
      this.audio.play('wrong')
    }
    this.renderChallenge()
    if (firstCard.pairKey !== card.pairKey) {
      this.memoryTimer = window.setTimeout(() => {
        if (!this.session || this.view !== 'challenge') return
        this.session.flippedCards = []
        this.session.feedback = ''
        this.renderChallenge()
      }, 900)
    }
  }

  private answerRound(choice: string): void {
    if (!this.session || this.view !== 'challenge' || this.session.roundAnswered) return
    const level = getCampaignLevel(this.session.levelId)
    const round = level.rounds[this.session.roundIndex]
    this.session.attempts += 1
    if (choice === round.answer) {
      this.session.correct += 1
      this.session.roundAnswered = true
      this.session.feedback = bubbleCorrect(round)
      this.scene.advanceRider()
      this.audio.play(level.mode === 'shoot' ? 'shoot' : 'match')
      this.speak(this.session.feedback)
    } else {
      this.session.mistakes += 1
      this.session.feedback = FEEDBACK.bubbleWrong
      this.audio.play('wrong')
      this.speak(this.session.feedback)
    }
    this.renderChallenge()
    if (!this.session.roundAnswered) this.campaignRoot.querySelector<HTMLButtonElement>('.target-option:not([disabled])')?.focus({ preventScroll: true })
    else this.campaignRoot.querySelector<HTMLButtonElement>('[data-action="advance-round"]')?.focus({ preventScroll: true })
  }

  private advanceRound(): void {
    if (!this.session || !this.session.roundAnswered) return
    const level = getCampaignLevel(this.session.levelId)
    if (this.session.roundIndex + 1 >= level.rounds.length) {
      this.finishLevel()
      return
    }
    this.session.roundIndex += 1
    this.session.roundAnswered = false
    this.session.feedback = ''
    const round = level.rounds[this.session.roundIndex]
    this.session.choiceOrder = shuffleChoices(round.choices)
    this.renderChallenge()
    this.announcer.textContent = roundSpeech(round, this.session.choiceOrder)
    this.speak(this.announcer.textContent)
  }

  private speakLevelGuide(level: CampaignLevel, roundText = ''): void {
    this.speak(levelGuide(level, roundText))
  }

  private selectMatchCell(index: number): void {
    if (!this.session || this.view !== 'challenge') return
    this.session.freshCells = []
    if (this.session.selectedCell === null) {
      this.session.selectedCell = index
      this.session.feedback = '選一塊，再點旁邊的圖塊交換。'
      this.audio.play('ui')
      this.renderChallenge()
      return
    }
    const selected = this.session.selectedCell
    if (selected === index) {
      this.session.selectedCell = null
      this.session.feedback = '再選一塊圖卡。'
      this.renderChallenge()
      return
    }
    const result = tryMatchSwap(this.session.grid, selected, index)
    if (!result.valid) {
      const rowDistance = Math.abs(Math.floor(selected / 5) - Math.floor(index / 5))
      const colDistance = Math.abs((selected % 5) - (index % 5))
      if (rowDistance + colDistance !== 1) {
        this.session.selectedCell = index
        this.session.feedback = '請選這塊旁邊的圖卡交換。'
      } else {
        this.session.selectedCell = null
        this.session.mistakes += 1
        this.session.feedback = FEEDBACK.matchNoLine
        this.audio.play('wrong')
        this.speak(this.session.feedback)
      }
      this.renderChallenge()
      return
    }
    const level = getCampaignLevel(this.session.levelId)
    const refill = collapseAndRefillMatches(result.board, result.matched, level.matchSymbols)
    this.session.grid = refill.board
    this.session.freshCells = refill.refilledIndices
    this.session.selectedCell = null
    this.session.matchesMade += Math.max(1, Math.floor(result.matched.length / 3))
    this.session.correct += 1
    this.session.feedback = FEEDBACK.matchCleared
    this.scene.advanceRider()
    this.audio.play('clear')
    this.speak(this.session.feedback)
    if (this.session.matchesMade >= level.matchTarget) {
      this.finishLevel()
      return
    }
    this.renderChallenge()
  }

  private toggleSound(): void {
    this.soundEnabled = !this.soundEnabled
    this.saveSetting(SOUND_KEY, this.soundEnabled)
    this.applySound()
    if (this.soundEnabled) void this.audio.unlock()
    if (this.view === 'map') this.renderMap()
    else if (this.view === 'challenge') this.renderChallenge()
    else if (this.view === 'complete') this.renderComplete()
    this.announcer.textContent = this.soundEnabled ? '配樂與音效已開啟。' : '配樂與音效已關閉。'
  }

  private toggleVoice(): void {
    if (!this.speechSupported) return
    this.voiceEnabled = !this.voiceEnabled
    this.saveSetting(VOICE_KEY, this.voiceEnabled)
    if (!this.voiceEnabled) window.speechSynthesis.cancel()
    if (this.view === 'map') this.renderMap()
    else if (this.view === 'challenge') this.renderChallenge()
    else if (this.view === 'complete') this.renderComplete()
    this.announcer.textContent = this.voiceEnabled ? '語音引導已開啟。選關後會聽到挑戰說明。' : '語音引導已關閉。你可以照著文字繼續遊玩。'
  }

  private speak(text: string): void {
    if (!this.voiceEnabled) return
    try {
      if (!Voice.for(this.audio).speak(text, 0.9)) this.announcer.textContent = '語音暫時無法播放，請依照畫面文字繼續。'
    } catch {
      this.announcer.textContent = '語音暫時無法播放，請依照畫面文字繼續。'
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.view === 'challenge' && event.key === 'Escape') {
      event.preventDefault()
      this.renderMap()
      return
    }
    if (this.view !== 'challenge' || !this.session || !['1', '2', '3'].includes(event.key)) return
    const level = getCampaignLevel(this.session.levelId)
    if (level.mode !== 'shoot' && level.mode !== 'relay') return
    const choice = this.session.choiceOrder[Number(event.key) - 1]
    if (choice) {
      event.preventDefault()
      this.answerRound(choice)
    }
  }
}
