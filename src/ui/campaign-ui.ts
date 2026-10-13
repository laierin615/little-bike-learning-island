import type { Audio } from '../engine/audio'
import { LearningScene } from '../game/learning-scene'
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_WORLDS,
  getCampaignLevel,
  getModeLabel,
  type CampaignLevel,
  type CampaignPrompt,
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

const VOICE_KEY = 'shuziyin.voice-guidance.v1'
const SOUND_KEY = 'shuziyin.sound-enabled.v1'
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

export class CampaignUi {
  private readonly campaignRoot: HTMLDivElement
  private readonly practiceRoot: HTMLDivElement
  private readonly announcer: HTMLDivElement
  private practiceUi: LearningUi | null = null
  private view: CampaignView = 'map'
  private progress = this.readProgress()
  private soundEnabled = this.readSetting(SOUND_KEY, true)
  private voiceEnabled = this.readSetting(VOICE_KEY, true)
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
    const completed = Object.keys(this.progress).length
    const stars = totalCampaignStars(this.progress)
    const worlds = CAMPAIGN_WORLDS.map(world => {
      const worldCompleted = world.levels.filter(level => (this.progress[level.id] ?? 0) > 0).length
      const nodes = world.levels.map(level => {
        const unlocked = isLevelUnlocked(level.id, this.progress)
        const earned = this.progress[level.id] ?? 0
        const state = !unlocked ? 'locked' : earned ? 'completed' : 'ready'
        const accessible = `第 ${level.id} 關，${level.title}，${getModeLabel(level.mode)}。${unlocked ? earned ? `已完成，${earned} 顆星。` : '可以開始。' : '完成前一關後開放。'}挑戰內容：${level.story}`
        return `<button class="campaign-node is-${state}" type="button" data-level="${level.id}" style="--world-color:${world.color}" aria-label="${html(accessible)}" ${unlocked ? '' : 'disabled'}>
          <span class="node-number">${level.id}</span>
          <span class="node-bike" aria-hidden="true">${!unlocked ? '🔒' : earned ? '🏁' : '🚴'}</span>
          <span class="node-title">${html(level.title)}</span>
          <span class="node-stars" aria-label="${earned} 顆星">${earned ? '★'.repeat(earned) + '☆'.repeat(3 - earned) : '☆☆☆'}</span>
        </button>`
      }).join('')
      return `<section class="world-card" style="--world-color:${world.color}" aria-labelledby="world-${world.id}">
        <header class="world-heading"><span class="world-icon" aria-hidden="true">${world.icon}</span><div class="world-heading-copy"><p>路段 ${world.id}</p><h2 id="world-${world.id}">${html(world.name)}</h2><small>${html(world.description)}</small></div><span class="world-count">${worldCompleted}<small> / 6</small></span></header>
        <div class="world-track" role="group" aria-label="${html(world.name)}六個關卡">${nodes}</div>
      </section>`
    }).join('')

    this.setScreen(`<main class="campaign-screen map-screen">
      <header class="campaign-header map-header">
        <div class="campaign-brand"><span class="campaign-brand-mark" aria-hidden="true">🚴</span><div><p>小小單車學習島</p><small>24 站學習冒險</small></div></div>
        <div class="campaign-controls">${this.soundButtonMarkup()}${this.modeLabelMarkup()}<div class="campaign-stars" aria-label="共獲得 ${stars} 顆星">★ <strong>${stars}</strong><small> / 72</small></div></div>
      </header>
      <section class="campaign-intro" aria-labelledby="campaign-title">
        <div><p class="campaign-kicker">踩踏板，慢慢闖關</p><h1 id="campaign-title">沿著單車小路<br><em>收集學習星星</em></h1><p class="campaign-copy">${completed} / 24 關完成　・　${stars} 顆里程星</p></div>
        <div class="campaign-progress-card"><span aria-hidden="true">🚲</span><div><strong>不用趕路</strong><small>答錯沒關係，通關就能開下一站</small></div></div>
      </section>
      <div class="campaign-map-scroll" role="region" aria-label="24 關騎行地圖">
        <div class="world-list">${worlds}</div>
        <p class="map-note">沒有倒數，也不會扣星星。騎到哪裡，都可以回來再玩。</p>
      </div>
      <footer class="campaign-footer"><span>戴好安全帽，準備出發！</span><button class="practice-entry" type="button" data-action="practice">自由練習　›</button></footer>
      <div class="sr-only" aria-live="polite">共有 24 關，已完成 ${completed} 關。選第一關開始騎行。</div>
    </main>`)

    const next = Math.min(CAMPAIGN_LEVELS.length, Math.max(1, ...Object.keys(this.progress).map(Number).filter(Number.isFinite).map(id => id + 1)))
    window.setTimeout(() => this.campaignRoot.querySelector<HTMLButtonElement>(`[data-level="${next}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
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
    if (!isLevelUnlocked(id, this.progress)) return
    this.clearMemoryTimer()
    const level = getCampaignLevel(id)
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
      grid: createMatchBoard(level.matchSymbols),
      selectedCell: null,
      matchesMade: 0,
      freshCells: [],
      feedback: '',
    }
    this.scene.setActivity(level.topic === 'mixed' ? null : level.topic)
    void this.audio.unlock()
    this.applySound()
    if (this.soundEnabled) {
      this.audio.startMusic()
      this.audio.play('ui')
    }
    this.renderChallenge()
    this.announcer.textContent = `${level.worldName}，第 ${level.id} 關，${level.title}。${level.challenge}`
    const roundText = level.mode === 'shoot' || level.mode === 'relay' ? this.roundSpeech(level.rounds[0]) : ''
    this.speakLevelGuide(level, roundText)
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
          : this.roundMarkup(level, this.session)
    const progress = this.modeProgress(level, this.session)
    this.setScreen(`<main class="campaign-screen play-screen" data-level-id="${level.id}" data-campaign-mode="${level.mode}" style="--world-color:${level.color}">
      <header class="campaign-header play-header">
        <button class="map-back" type="button" data-action="back-map" aria-label="回到 24 關地圖">‹ 地圖</button>
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
  }

  private modeProgress(level: CampaignLevel, session: Session): { current: number; total: number; label: string } {
    if (level.mode === 'connect' || level.mode === 'memory') {
      return { current: session.matchedPairs.length, total: level.pairs.length, label: `${session.matchedPairs.length} / ${level.pairs.length} 組好朋友` }
    }
    if (level.mode === 'match3') {
      return { current: Math.min(session.matchesMade, level.matchTarget), total: level.matchTarget, label: `${Math.min(session.matchesMade, level.matchTarget)} / ${level.matchTarget} 次消除` }
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
    const options = round.choices.map((choice, index) => `<button class="target-option ${session.roundAnswered && choice === round.answer ? 'is-correct' : ''}" type="button" data-round-choice="${html(choice)}" ${session.roundAnswered ? 'disabled' : ''} aria-label="選擇 ${html(choice)}，第 ${index + 1} 個目標"><span class="target-bubble" aria-hidden="true">${html(choice)}</span><small>泡泡 ${index + 1}</small></button>`).join('')
    const icon = level.mode === 'shoot' ? '🎯' : '🏁'
    const label = level.mode === 'shoot' ? '泡泡射擊' : '接力挑戰'
    return `<div class="mode-instructions"><span class="mode-icon" aria-hidden="true">${icon}</span><div><strong>${label}</strong><small>看圖和題目，點一下正確的泡泡目標。</small></div><span class="round-number">${session.roundIndex + 1} / ${level.rounds.length}</span></div><div class="round-prompt"><div class="round-picture" role="img" aria-label="${html(round.pictureLabel)}">${html(round.picture)}</div><h2>${html(round.prompt)}</h2><p>選一個答案；答錯沒有關係。</p></div><div class="target-row" role="group" aria-label="選擇正確目標">${options}</div>`
  }

  private match3Markup(level: CampaignLevel, session: Session): string {
    const tiles = session.grid.map((symbol, index) => `<button class="match-tile ${session.selectedCell === index ? 'is-selected' : ''} ${session.freshCells.includes(index) ? 'is-fresh' : ''}" type="button" role="gridcell" data-match-cell="${index}" aria-label="第 ${Math.floor(index / 5) + 1} 排第 ${index % 5 + 1} 格，${html(symbol)}" aria-pressed="${session.selectedCell === index}">${html(symbol)}</button>`).join('')
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
    const nextUnlocked = hasNext && isLevelUnlocked(nextId, this.progress)
    this.setScreen(`<main class="campaign-screen result-screen" style="--world-color:${level.color}"><section class="result-card" aria-labelledby="result-title"><div class="result-decoration" aria-hidden="true">✦　🚴　✦</div><span class="result-bike" aria-hidden="true">🏁</span><p class="campaign-kicker">${html(level.worldName)}・第 ${level.id} 關</p><h1 id="result-title">${level.id === 24 ? '騎到大終點！' : '太棒了！'}</h1><p class="result-copy">完成「${html(level.title)}」，又學會一個新本領。</p><div class="result-stars" aria-label="本關獲得 ${stars} 顆星">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div><p class="result-unlock">${hasNext ? `下一站「${html(getCampaignLevel(nextId).title)}」已開放。` : '24 關全部完成！你是單車學習小高手。'}</p>${nextUnlocked ? '<button class="campaign-primary" type="button" data-action="next-level">騎往下一關　›</button>' : ''}<button class="secondary-button" type="button" data-action="replay-level">再玩這一關</button><button class="text-button" type="button" data-action="back-map">回到關卡地圖</button></section></main>`)
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
    this.speak(`太棒了！完成${level.title}，獲得 ${this.progress[levelId]} 顆星。騎到終點啦！`)
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!button || button.disabled) return
    if (button.dataset.level) {
      this.startLevel(Number(button.dataset.level))
      return
    }
    const action = button.dataset.action
    if (action === 'practice') this.enterPractice()
    else if (action === 'back-map') this.renderMap()
    else if (action === 'next-level') this.startLevel(this.completedLevelId + 1)
    else if (action === 'replay-level') this.startLevel(this.completedLevelId)
    else if (action === 'replay-guide' && this.session) {
      const level = getCampaignLevel(this.session.levelId)
      const roundText = level.mode === 'shoot' || level.mode === 'relay' ? this.roundSpeech(level.rounds[this.session.roundIndex]) : ''
      this.speakLevelGuide(level, roundText)
    }
    else if (action === 'advance-round') this.advanceRound()
    else if (action === 'sound-toggle') this.toggleSound()
    else if (action === 'voice-toggle') this.toggleVoice()
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
        this.session.feedback = `連對了！${pair.learningNote}`
        this.scene.advanceRider()
        this.audio.play('match')
        this.speak(`連對了！${pair.learningNote}`)
        const done = this.session.matchedPairs.length >= level.pairs.length
        if (done) {
          this.finishLevel()
          return
        }
      } else {
        this.session.mistakes += 1
        this.session.feedback = '這兩張還不是好朋友，換一張再找找看！'
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
      this.speak(`配對成功！${pair.learningNote}`)
      if (this.session.matchedPairs.length >= level.pairs.length) {
        this.finishLevel()
        return
      }
    } else {
      this.session.flippedCards = [firstIndex, index]
      this.session.mistakes += 1
      this.session.feedback = '先看一看這兩張，再試著記住位置。慢慢來！'
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
      this.session.feedback = `答對了！${round.explanation}`
      this.scene.advanceRider()
      this.audio.play(level.mode === 'shoot' ? 'shoot' : 'match')
      this.speak(this.session.feedback)
    } else {
      this.session.mistakes += 1
      this.session.feedback = '差一點！再看看圖，換一個泡泡試試看。'
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
    this.renderChallenge()
    const round = level.rounds[this.session.roundIndex]
    this.announcer.textContent = this.roundSpeech(round)
    this.speak(this.roundSpeech(round))
  }

  private roundSpeech(round: CampaignPrompt): string {
    return `${round.prompt}。答案選項：${round.choices.join('、')}。`
  }

  private speakLevelGuide(level: CampaignLevel, roundText = ''): void {
    this.speak(`${level.worldName}。第 ${level.id} 關，${level.title}。${level.challenge}${roundText}`)
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
        this.session.feedback = '還沒排成三個相同符號，沒關係，再試另一條路！'
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
    this.session.feedback = '消除成功！單車再前進一段路。'
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
    if (!this.speechSupported || !this.voiceEnabled) return
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim())
      utterance.lang = 'zh-TW'
      utterance.rate = 0.9
      utterance.pitch = 1.02
      utterance.volume = 1
      window.speechSynthesis.speak(utterance)
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
    const choice = level.rounds[this.session.roundIndex]?.choices[Number(event.key) - 1]
    if (choice) {
      event.preventDefault()
      this.answerRound(choice)
    }
  }
}
