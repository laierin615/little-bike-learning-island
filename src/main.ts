import './styles/main.css'
import './ui/learning-ui.css'
import './ui/campaign-ui.css'
import { Audio } from './engine/audio'
import { GameLoop } from './engine/loop'
import { Renderer } from './engine/renderer'
import { LearningScene } from './game/learning-scene'
import { tuning } from './game/tuning'
import { CampaignUi } from './ui/campaign-ui'
import faviconUrl from '../assets/share/favicon.png'

async function boot(): Promise<void> {
  document.documentElement.lang = 'zh-Hant'
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const root = document.getElementById('ui')!
  const bootImage = document.getElementById('boot-icon') as HTMLImageElement | null
  if (bootImage) bootImage.src = faviconUrl

  const renderer = new Renderer(canvas, 'medium')
  const audio = new Audio()
  const scene = new LearningScene(renderer)
  await scene.loadRider()
  const ui = new CampaignUi(root, scene, audio)

  if (import.meta.env.DEV) {
    const { registerGameTuning } = await import('../scripts/manus-tuning/adapter.js')
    await registerGameTuning(tuning)
  }

  const loop = new GameLoop({
    step: dt => scene.step(dt),
    render: (alpha, frameSeconds) => scene.render(alpha, frameSeconds),
  })
  loop.start()

  window.addEventListener('pagehide', () => {
    loop.stop()
    audio.stopMusic()
    window.speechSynthesis?.cancel()
    audio.ctx.close().catch(() => undefined)
  }, { once: true })

  window.setTimeout(() => {
    document.querySelector('.preboot')?.classList.add('is-done')
  }, 260)

  ;(window as unknown as { __game: unknown }).__game = { game: scene, ui, audio, tuning }
}

boot().catch(error => {
  console.error(error)
  const root = document.getElementById('ui')
  if (root) root.innerHTML = `<div class="fatal-screen"><strong>遊戲暫時無法載入</strong><p>請重新整理頁面再試一次。</p><button type="button" onclick="location.reload()">重新載入</button></div>`
})
