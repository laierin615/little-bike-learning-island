import type { Audio } from '../engine/audio'
import { Voice } from '../engine/voice'
import { FEEDBACK, practiceComplete, practiceCorrect, practiceIntro, practiceQuestion } from '../game/speech-lines'
import { ACTIVITIES, answerIsCorrect, getActivity, type ActivityId, type LessonQuestion } from '../game/lessons'
import { LearningScene } from '../game/learning-scene'

type View = 'home' | 'lesson' | 'complete'
type Progress = Partial<Record<ActivityId, boolean>>
const PROGRESS_KEY = 'shuziyin.learning-progress.v1'
const VOICE_KEY = 'shuziyin.voice-guidance.v1'
const SOUND_KEY = 'shuziyin.sound-enabled.v1'

export class LearningUi {
  private view: View = 'home'
  private activityId: ActivityId | null = null
  private questionIndex = 0
  private answered = false
  private feedback = ''
  private progress = this.readProgress()
  private voiceEnabled = this.readVoiceSetting()
  private soundEnabled = this.readSoundSetting()
  private readonly speechSupported = typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined'
  private readonly announcer: HTMLElement

  constructor(
    private readonly root: HTMLElement,
    private readonly scene: LearningScene,
    private readonly audio: Audio,
    private readonly onReturnToCampaign: () => void = () => {},
  ) {
    this.announcer = document.createElement('div')
    this.announcer.className = 'sr-only'
    this.announcer.setAttribute('aria-live', 'polite')
    this.announcer.setAttribute('aria-atomic', 'true')
    this.root.innerHTML = ''
    this.root.append(this.announcer)
    this.showHome()
    this.root.addEventListener('click', event => this.onClick(event))
    window.addEventListener('keydown', event => this.onKeyDown(event))
  }

  get state(): { view: View; activityId: ActivityId | null; questionIndex: number; answered: boolean; completed: Progress } {
    return { view: this.view, activityId: this.activityId, questionIndex: this.questionIndex, answered: this.answered, completed: { ...this.progress } }
  }

  private showHome(): void {
    this.stopSpeech()
    this.view = 'home'
    this.activityId = null
    this.scene.setActivity(null)
    this.root.querySelector('.learning-screen')?.remove()
    this.root.insertAdjacentHTML('beforeend', this.homeTemplate())
    this.announcer.textContent = '選一個關卡開始學習。語音引導可以在右上角開啟或關閉。'
  }

  private start(id: ActivityId): void {
    void this.audio.unlock()
    this.applySound()
    if (this.soundEnabled) this.audio.play('ui')
    this.activityId = id
    this.questionIndex = 0
    this.answered = false
    this.feedback = ''
    this.view = 'lesson'
    this.scene.setActivity(id)
    this.renderLesson()
    this.speakLevelIntro()
  }

  private answer(choice: string): void {
    if (this.view !== 'lesson' || this.answered || !this.activityId) return
    const activity = getActivity(this.activityId)
    const question = activity.questions[this.questionIndex]
    if (answerIsCorrect(question, choice)) {
      this.answered = true
      this.scene.advanceRider()
      this.feedback = `${question.memoryTip}　🚴 太好了，騎到下一個路標！`
      this.audio.play('pickup')
      this.announcer.textContent = `答對了！${question.memoryTip}`
    } else {
      this.feedback = FEEDBACK.practiceWrong
      this.audio.play('ui')
      this.announcer.textContent = this.feedback
    }
    this.renderLesson()
    this.speak(this.answered
      ? practiceCorrect(question)
      : this.feedback)
    if (!this.answered) this.root.querySelector<HTMLButtonElement>('.answer-option:not([disabled])')?.focus({ preventScroll: true })
    else this.root.querySelector<HTMLButtonElement>('[data-action="next"]')?.focus({ preventScroll: true })
  }

  private next(): void {
    if (!this.answered || !this.activityId) return
    const activity = getActivity(this.activityId)
    if (this.questionIndex + 1 < activity.questions.length) {
      this.questionIndex += 1
      this.answered = false
      this.feedback = ''
      this.renderLesson()
      this.speakQuestion()
      this.root.querySelector<HTMLButtonElement>('.answer-option')?.focus({ preventScroll: true })
      return
    }
    this.progress[this.activityId] = true
    this.writeProgress()
    this.view = 'complete'
    this.renderComplete(activity.title)
    this.audio.play('win')
    this.speak(practiceComplete(activity))
  }

  private renderLesson(): void {
    if (!this.activityId) return
    const activity = getActivity(this.activityId)
    const question = activity.questions[this.questionIndex]
    this.view = 'lesson'
    this.root.querySelector('.learning-screen')?.remove()
    this.root.insertAdjacentHTML('beforeend', this.lessonTemplate(activity.id, activity.title, question, this.questionIndex, activity.questions.length))
    const feedback = this.root.querySelector<HTMLElement>('.answer-feedback')
    if (feedback) {
      feedback.textContent = this.feedback
      feedback.classList.toggle('is-correct', this.answered)
      feedback.classList.toggle('is-try-again', !this.answered && !!this.feedback)
    }
  }

  private renderComplete(title: string): void {
    this.root.querySelector('.learning-screen')?.remove()
    this.root.insertAdjacentHTML('beforeend', `
      <main class="learning-screen complete-screen">
        <section class="complete-card" aria-labelledby="complete-title">
          <div class="complete-confetti" aria-hidden="true">✦　★　✦</div>
          <div class="complete-icon" aria-hidden="true">🚴</div>
          <p class="eyebrow">騎到終點啦！</p>
          <h1 id="complete-title">太棒了！</h1>
          <p class="complete-copy">你完成了「${title}」，一路上學會了新本領！</p>
          <div class="complete-stars" aria-label="獲得三顆里程星">★　★　★</div>
          <button class="primary-button" type="button" data-action="home">回到關卡選單</button>
          <button class="text-button" type="button" data-action="replay">再玩一次</button>
        </section>
      </main>`)
    this.root.querySelector<HTMLButtonElement>('[data-action="home"]')?.focus({ preventScroll: true })
    this.announcer.textContent = `太棒了！你完成了「${title}」。`
  }

  private homeTemplate(): string {
    const doneCount = ACTIVITIES.filter(activity => this.progress[activity.id]).length
    const cards = ACTIVITIES.map((activity, index) => `
      <button class="level-card level-${activity.id}" type="button" data-activity="${activity.id}" style="--level-color:${activity.color}" aria-label="第 ${index + 1} 關：${activity.title}。${activity.subtitle}。${activity.description}">
        <span class="level-number">第 ${index + 1} 關</span>
        <span class="level-icon" aria-hidden="true">${activity.icon}</span>
        <span class="level-copy"><strong>${activity.title}</strong><small>${activity.subtitle}</small></span>
        <span class="level-status">${this.progress[activity.id] ? '已完成　★' : '開始闖關　›'}</span>
      </button>`).join('')
    return `
      <main class="learning-screen home-screen">
        <header class="brand-row">
          <div class="brand-mark" aria-hidden="true"><span>🚴</span><i>★</i></div>
          <div><p class="brand-kicker">小小單車學習島</p><p class="brand-note">騎車數數・注音・圖像認字</p></div>
          ${this.soundButtonMarkup()}
          ${this.voiceButtonMarkup()}
          <div class="home-progress" aria-label="已完成 ${doneCount} 個關卡，共 ${ACTIVITIES.length} 個">
            <span>里程星星</span><strong>${doneCount} <small>/ ${ACTIVITIES.length}</small></strong>
          </div>
        </header>
        <section class="home-intro" aria-labelledby="home-title">
          <p class="eyebrow">戴好安全帽，準備出發！</p>
          <h1 id="home-title">踩下踏板<br><em>開始學習！</em></h1>
          <p class="home-copy">沿著小路騎一騎，<br>收集數字、注音和新字。</p>
          <div class="home-note"><span aria-hidden="true">🚴</span> 答對一道題，腳踏車就前進一步！</div>
        </section>
        <section class="level-list" aria-label="學習關卡">${cards}</section>
        <footer class="home-footer"><span>慢慢騎、慢慢想，不用趕時間。</span><button class="text-button campaign-return" type="button" data-action="campaign-map">↩ 回到 24 關地圖</button><span class="footer-spark" aria-hidden="true">✦</span></footer>
      </main>`
  }

  private lessonTemplate(id: ActivityId, title: string, question: LessonQuestion, index: number, total: number): string {
    const activity = getActivity(id)
    const progressWidth = ((index + 1) / total) * 100
    const picture = question.objects
      ? `<div class="counting-pictures" role="img" aria-label="${question.objects.length} 個${question.pictureLabel}">${question.objects.map(item => `<span aria-hidden="true">${item}</span>`).join('')}</div>`
      : `<div class="picture-emoji" role="img" aria-label="${question.pictureLabel}">${question.picture}</div>`
    const word = question.word ? `<span class="picture-word">${question.word}</span>` : ''
    const choices = question.choices.map(choice => `
      <button class="answer-option ${this.answered && choice === question.answer ? 'is-right' : ''}" type="button" data-answer="${choice}" ${this.answered ? 'disabled' : ''} aria-label="選擇 ${choice}">
        <span class="answer-glyph">${choice}</span>
        ${this.answered && choice === question.answer ? '<span class="answer-check" aria-hidden="true">✓</span>' : ''}
      </button>`).join('')
    return `
      <main class="learning-screen lesson-screen" style="--level-color:${activity.color}">
        <header class="lesson-topbar">
          <button class="back-button" type="button" data-action="home" aria-label="回到關卡選單">‹ <span>關卡</span></button>
          <div class="lesson-heading"><span class="lesson-heading-icon" aria-hidden="true">${activity.icon}</span><span>${title}</span></div>
          <div class="lesson-tools">${this.soundButtonMarkup()}${this.voiceButtonMarkup()}<div class="question-count">${index + 1}<small> / ${total}</small></div></div>
        </header>
        <div class="lesson-progress" role="progressbar" aria-label="關卡進度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${index + 1}"><i style="width:${progressWidth}%"></i></div>
        <section class="lesson-layout" aria-labelledby="question-title">
          <div class="picture-panel">
            <p class="picture-label"><span aria-hidden="true">✦</span> ${activity.pictureLabel}</p>
            <div class="picture-frame">${picture}</div>
            ${word}
            <p class="picture-reminder">仔細看看圖裡有什麼</p>
          </div>
          <div class="question-panel">
            <p class="level-description">${activity.description}</p>
            <div class="question-line">
              <p class="eyebrow">第 ${index + 1} 題</p>
              <button class="speech-replay" type="button" data-action="speak-question" ${this.speechSupported ? '' : 'disabled'} aria-label="重播題目和答案選項語音">🔊 <span>聽題目</span></button>
            </div>
            <h1 id="question-title">${question.prompt}</h1>
            <div class="answer-grid" role="group" aria-label="選擇答案">${choices}</div>
            <p class="answer-feedback ${this.answered ? 'is-correct' : this.feedback ? 'is-try-again' : ''}" aria-live="polite">${this.feedback || '選一個你覺得正確的答案。'}</p>
            ${this.answered ? '<button class="primary-button next-button" type="button" data-action="next">下一題　›</button>' : ''}
            <p class="gentle-hint">答對就騎到下一個路標，答錯也可以再試一次！</p>
          </div>
        </section>
      </main>`
  }

  private soundButtonMarkup(): string {
    const title = this.soundEnabled ? '配樂與音效已開啟；按一下靜音' : '配樂與音效已關閉；按一下開啟'
    return `<button class="voice-toggle sound-toggle" type="button" data-action="sound-toggle" aria-pressed="${this.soundEnabled}" aria-label="配樂與音效" title="${title}"><span class="voice-toggle-icon" aria-hidden="true">${this.soundEnabled ? '🎵' : '🔇'}</span><span class="sr-only">${title}</span></button>`
  }

  private voiceButtonMarkup(): string {
    const active = this.speechSupported && this.voiceEnabled
    const title = this.speechSupported
      ? (this.voiceEnabled ? '繁體中文語音引導已開啟；按一下關閉' : '繁體中文語音引導已關閉；按一下開啟')
      : '此瀏覽器不支援語音引導，仍可閱讀畫面文字'
    return `<button class="voice-toggle" type="button" data-action="voice-toggle" ${this.speechSupported ? '' : 'disabled'} aria-pressed="${active}" aria-label="繁體中文語音引導" title="${title}"><span class="voice-toggle-icon" aria-hidden="true">${active ? '🔊' : '🔇'}</span><span class="sr-only">${title}</span></button>`
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!target || target.disabled) return
    if (target.dataset.activity) this.start(target.dataset.activity as ActivityId)
    else if (target.dataset.answer) this.answer(target.dataset.answer)
    else if (target.dataset.action === 'next') this.next()
    else if (target.dataset.action === 'home') this.showHome()
    else if (target.dataset.action === 'replay' && this.activityId) this.start(this.activityId)
    else if (target.dataset.action === 'campaign-map') this.onReturnToCampaign()
    else if (target.dataset.action === 'sound-toggle') this.toggleSound()
    else if (target.dataset.action === 'voice-toggle') this.toggleVoice()
    else if (target.dataset.action === 'speak-question') this.speakQuestion()
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.view !== 'lesson' || this.answered || !['1', '2', '3'].includes(event.key) || !this.activityId) return
    const choice = getActivity(this.activityId).questions[this.questionIndex].choices[Number(event.key) - 1]
    if (choice) {
      event.preventDefault()
      this.answer(choice)
    }
  }

  private speakLevelIntro(): void {
    if (!this.activityId) return
    this.speak(practiceIntro(getActivity(this.activityId), this.questionIndex))
  }

  private speakQuestion(): void {
    if (!this.activityId) return
    const question = getActivity(this.activityId).questions[this.questionIndex]
    this.speak(this.questionText(question, this.questionIndex))
  }

  private questionText(question: LessonQuestion, index: number): string {
    return practiceQuestion(question, index)
  }

  private speak(text: string): void {
    if (!this.voiceEnabled) return
    try {
      if (!Voice.for(this.audio).speak(text, 0.88)) this.announcer.textContent = '語音暫時無法播放，請依照畫面文字繼續。'
    } catch {
      this.announcer.textContent = '語音暫時無法播放，請依照畫面文字繼續。'
    }
  }


  private stopSpeech(): void {
    if (this.speechSupported) window.speechSynthesis.cancel()
  }

  private applySound(): void {
    this.audio.setVolumes(0.24, 0.65, !this.soundEnabled)
    if (this.soundEnabled) this.audio.startMusic()
    else this.audio.stopMusic()
  }

  private toggleSound(): void {
    this.soundEnabled = !this.soundEnabled
    this.applySound()
    this.audio.unlock()
    try {
      localStorage.setItem(SOUND_KEY, String(this.soundEnabled))
    } catch {
      // The sound setting remains available for this visit when storage is blocked.
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="sound-toggle"]').forEach(button => {
      button.setAttribute('aria-pressed', String(this.soundEnabled))
      const label = this.soundEnabled ? '配樂與音效已開啟；按一下靜音' : '配樂與音效已關閉；按一下開啟'
      button.title = label
      const icon = button.querySelector<HTMLElement>('.voice-toggle-icon')
      if (icon) icon.textContent = this.soundEnabled ? '🎵' : '🔇'
      const hiddenLabel = button.querySelector<HTMLElement>('.sr-only')
      if (hiddenLabel) hiddenLabel.textContent = label
    })
    this.announcer.textContent = this.soundEnabled ? '配樂與音效已開啟。' : '配樂與音效已關閉。'
  }

  private toggleVoice(): void {
    if (!this.speechSupported) return
    this.voiceEnabled = !this.voiceEnabled
    try {
      localStorage.setItem(VOICE_KEY, String(this.voiceEnabled))
    } catch {
      // Voice guidance still works for this visit when browser storage is unavailable.
    }
    if (!this.voiceEnabled) this.stopSpeech()
    const title = this.voiceEnabled ? '繁體中文語音引導已開啟' : '繁體中文語音引導已關閉'
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="voice-toggle"]').forEach(button => {
      button.setAttribute('aria-pressed', String(this.voiceEnabled))
      button.title = `${title}；按一下${this.voiceEnabled ? '關閉' : '開啟'}`
      const icon = button.querySelector<HTMLElement>('.voice-toggle-icon')
      if (icon) icon.textContent = this.voiceEnabled ? '🔊' : '🔇'
      const hiddenLabel = button.querySelector<HTMLElement>('.sr-only')
      if (hiddenLabel) hiddenLabel.textContent = button.title
    })
    this.announcer.textContent = title
  }

  private readSoundSetting(): boolean {
    try {
      const setting = localStorage.getItem(SOUND_KEY)
      return setting === null ? true : setting === 'true'
    } catch {
      return true
    }
  }

  private readVoiceSetting(): boolean {
    try {
      const setting = localStorage.getItem(VOICE_KEY)
      return setting === null ? true : setting === 'true'
    } catch {
      return true
    }
  }

  private readProgress(): Progress {
    try {
      const data = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, unknown>
      return Object.fromEntries(ACTIVITIES.filter(activity => data[activity.id] === true).map(activity => [activity.id, true])) as Progress
    } catch {
      return {}
    }
  }

  private writeProgress(): void {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress))
    } catch {
      // The game remains playable when browser storage is unavailable.
    }
  }
}
