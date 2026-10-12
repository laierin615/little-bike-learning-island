// End-to-end smoke test for the Traditional Chinese cycling-learning game.
// Run after `pnpm build`; captures desktop and phone screenshots in ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out'), 120_000)
function cleanup() { clearTimeout(guard); try { server.kill('SIGTERM') } catch {} }
async function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('preview server did not start')
}
function watchErrors(page, errors) {
  page.on('console', message => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', response => response.status() >= 400 && errors.push(`HTTP ${response.status()} ${response.url()}`))
}
async function openGame(context, errors) {
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__speechLog = []
    class TestUtterance {
      constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1 }
    }
    try { Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance }) } catch {}
    const speech = {
      cancel() {},
      getVoices() { return [] },
      speak(utterance) { window.__speechLog.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate }) },
    }
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech }) }
    catch { window.speechSynthesis.cancel = speech.cancel; window.speechSynthesis.speak = speech.speak }
  })
  watchErrors(page, errors)
  await page.goto(url)
  await page.waitForSelector('.home-screen', { timeout: 30_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.documentElement.lang !== 'zh-Hant') throw new Error(`Expected zh-Hant, got ${document.documentElement.lang}`)
    if (![...document.fonts].some(face => face.family.replaceAll('"', '').replaceAll("'", '') === 'ManusCC0 Sans CJK SC' && face.status === 'loaded')) {
      throw new Error('Bundled Traditional Chinese font did not load')
    }
  })
  return page
}
async function answerCurrent(page, choice) {
  await page.locator(`.answer-option[data-answer="${choice}"]`).click()
  await page.waitForSelector('.answer-feedback.is-correct')
  await page.locator('[data-action="next"]').click()
}
async function finishLesson(page, correctAnswers) {
  for (const answer of correctAnswers) await answerCurrent(page, answer)
  await page.waitForSelector('.complete-screen')
}

try {
  await waitForServer()
  const routes = await (await fetch(`${url}manus-routes.json`)).json()
  if (routes.routes?.[0]?.path !== '/') throw new Error('Route manifest did not publish the home page')
  browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] }).catch(() => chromium.launch({ args: ['--ignore-gpu-blocklist'], channel: 'chrome' }))
  const errors = []
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' })
  const page = await openGame(desktop, errors)
  await page.screenshot({ path: `${out}/01-home-desktop.png` })
  for (const title of ['數字果園', '注音森林', '圖像認字屋']) {
    if (!(await page.getByText(title, { exact: true }).count())) throw new Error(`Missing level ${title}`)
  }
  const tweakCount = await page.evaluate(() => window.__game.tuning.controls.length)
  if (tweakCount !== 3) throw new Error(`Expected three live Tweak camera controls, got ${tweakCount}`)
  const riderLoaded = await page.evaluate(() => window.__game.game.riderLoaded)
  if (!riderLoaded) throw new Error('The supplied bicycle-rider character did not load')
  const signCount = await page.evaluate(() => window.__game.game.learningSignCount)
  if (signCount !== 3) throw new Error(`Expected three floating lesson signs, got ${signCount}`)

  await page.locator('[data-activity="numbers"]').click()
  await page.waitForSelector('.lesson-screen')
  if (!(await page.getByRole('heading', { name: '數一數，有幾顆蘋果？' }).count())) throw new Error('Number lesson did not start')
  const numberDescription = await page.locator('.level-description').innerText()
  if (!numberDescription.includes('數字果園') || !numberDescription.includes('正確數字')) throw new Error('Number lesson story is missing its learning goal')
  const numberSky = await page.evaluate(() => window.__game.game.scene.background.getHexString())
  const introSpeech = await page.evaluate(() => window.__speechLog[0])
  if (!introSpeech?.text.includes('數字果園') || !introSpeech.text.includes('蘋果') || introSpeech.lang !== 'zh-TW') throw new Error('Number lesson did not speak its Traditional Chinese intro and first question')
  const voiceButton = page.locator('.lesson-screen [data-action="voice-toggle"]')
  if (await voiceButton.getAttribute('aria-pressed') !== 'true') throw new Error('Voice guidance should be enabled by default')
  await voiceButton.click()
  if (await voiceButton.getAttribute('aria-pressed') !== 'false') throw new Error('Voice toggle did not turn off')
  const mutedSpeechCount = await page.evaluate(() => window.__speechLog.length)
  await page.locator('[data-action="speak-question"]').click()
  if (await page.evaluate(() => window.__speechLog.length) !== mutedSpeechCount) throw new Error('Question replay spoke while voice guidance was off')
  await voiceButton.click()
  await page.locator('[data-action="speak-question"]').click()
  const replaySpeech = await page.evaluate(() => window.__speechLog.at(-1))
  if (!replaySpeech?.text.includes('答案選項') || replaySpeech.lang !== 'zh-TW') throw new Error('Question replay did not read the prompt and choices in Traditional Chinese')
  const rideStepsBefore = await page.evaluate(() => window.__game.game.rideSteps)
  await page.locator('.answer-option[data-answer="2"]').click()
  await page.waitForSelector('.answer-feedback.is-try-again')
  if (await page.locator('[data-action="next"]').count()) throw new Error('A wrong answer advanced the lesson')
  if ((await page.locator('.question-count').innerText()).trim() !== '1 / 5') throw new Error('A wrong answer changed question progress')
  if (await page.evaluate(() => window.__game.game.rideSteps) !== rideStepsBefore) throw new Error('A wrong answer moved the bicycle rider')
  await page.screenshot({ path: `${out}/02-retry-desktop.png` })
  await page.locator('.answer-option[data-answer="3"]').click()
  await page.waitForSelector('.answer-feedback.is-correct')
  if (await page.evaluate(() => window.__game.game.rideSteps) !== rideStepsBefore + 1) throw new Error('A correct answer did not advance the bicycle rider')
  await page.screenshot({ path: `${out}/03-correct-desktop.png` })
  await page.locator('[data-action="next"]').click()
  await finishLesson(page, ['5', '4', '6', '7'])
  if (!(await page.getByText('太棒了！', { exact: true }).count())) throw new Error('Completion screen did not appear')
  await page.screenshot({ path: `${out}/04-complete-desktop.png` })
  await page.locator('[data-action="home"]').click()
  if (!(await page.locator('[data-activity="numbers"]').innerText()).includes('已完成')) throw new Error('Completed progress did not return to the home screen')
  await page.reload()
  await page.waitForSelector('.home-screen')
  if (!(await page.locator('[data-activity="numbers"]').innerText()).includes('已完成')) throw new Error('Completed progress did not persist after reload')
  await page.locator('[data-activity="zhuyin"]').click()
  await page.waitForSelector('.lesson-screen')
  const zhuyinDescription = await page.locator('.level-description').innerText()
  if (!zhuyinDescription.includes('注音森林') || !zhuyinDescription.includes('第一個注音')) throw new Error('Zhuyin lesson story is missing its learning goal')
  const zhuyinSky = await page.evaluate(() => window.__game.game.scene.background.getHexString())
  if (zhuyinSky === numberSky) throw new Error('The number and Zhuyin scenes should use distinct sky colors')
  const zhuyinSpeech = await page.evaluate(() => window.__speechLog[0])
  if (!zhuyinSpeech?.text.includes('注音森林') || !zhuyinSpeech.text.includes('ㄇ')) throw new Error('Zhuyin lesson did not speak its intro, symbol choices and question')
  await page.locator('.answer-option[data-answer="ㄇ"]').click()
  await page.waitForSelector('.answer-feedback.is-correct')
  const zhuyinFeedback = await page.evaluate(() => window.__speechLog.at(-1)?.text ?? '')
  if (!zhuyinFeedback.includes('貓咪') || !zhuyinFeedback.includes('ㄇ')) throw new Error('Zhuyin answer feedback was not spoken')
  await page.locator('[data-action="home"]').click()
  await desktop.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' })
  const phonePage = await openGame(phone, errors)
  await phonePage.screenshot({ path: `${out}/05-home-phone.png`, fullPage: true })
  await phonePage.locator('[data-activity="characters"]').tap()
  await phonePage.waitForSelector('.lesson-screen')
  await phonePage.locator('.answer-option[data-answer="日"]').tap()
  await phonePage.waitForSelector('.answer-feedback.is-correct')
  const memoryFeedback = await phonePage.locator('.answer-feedback').innerText()
  if (!memoryFeedback.includes('太陽') || !memoryFeedback.includes('日')) throw new Error('Picture-assisted character memory feedback is missing')
  await phonePage.screenshot({ path: `${out}/06-picture-character-phone.png`, fullPage: true })
  await phone.close()
  if (errors.length) throw new Error(`console errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — screenshots in ${out}/`)
} catch (error) {
  await fail(error?.message ?? String(error))
}
