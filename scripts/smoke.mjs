// End-to-end smoke test for the 30-level bicycle learning campaign.
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
  page.on('console', message => message.type() === 'error' && errors.push(`${message.text()} @ ${message.location().url}`))
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
  await page.waitForSelector('.map-screen', { timeout: 30_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.documentElement.lang !== 'zh-Hant') throw new Error(`Expected zh-Hant, got ${document.documentElement.lang}`)
    if (![...document.fonts].some(face => face.family.replaceAll('"', '').replaceAll("'", '') === 'ManusCC0 Sans CJK SC' && face.status === 'loaded')) {
      throw new Error('Bundled Traditional Chinese font did not load')
    }
  })
  await page.waitForTimeout(320)
  return page
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
async function finishConnect(page, tap = false) {
  let guardCount = 0
  while (!(await page.locator('.result-screen').count())) {
    if (guardCount++ > 8) throw new Error('Connection level did not finish')
    const first = page.locator('.pair-card[data-pair-side="left"]:not([disabled])').first()
    if (!(await first.count())) throw new Error('No unmatched left cards remain')
    const key = await first.getAttribute('data-pair-key')
    if (!key) throw new Error('Connection card omitted its pair id')
    if (tap) await first.tap(); else await first.click()
    const partner = page.locator(`.pair-card[data-pair-side="right"][data-pair-key="${key}"]`)
    if (tap) await partner.tap(); else await partner.click()
  }
}
async function finishMemory(page) {
  let guardCount = 0
  while (!(await page.locator('.result-screen').count())) {
    if (guardCount++ > 8) throw new Error('Memory level did not finish')
    const first = page.locator('.memory-card:not([disabled])').first()
    if (!(await first.count())) throw new Error('No unmatched memory cards remain')
    const key = await first.getAttribute('data-pair-key')
    if (!key) throw new Error('Memory card omitted its pair id')
    await first.click()
    const mate = page.locator(`.memory-card[data-pair-key="${key}"]:not(.is-open):not([disabled])`).first()
    await mate.click()
    await page.waitForFunction(pairKey => {
      return [...document.querySelectorAll('.memory-card.is-matched')].some(card => card.getAttribute('data-pair-key') === pairKey)
        || Boolean(document.querySelector('.result-screen'))
    }, key)
  }
}
async function finishRounds(page) {
  const total = Number(await page.locator('.challenge-progress').getAttribute('aria-valuemax'))
  assert(total >= 3, `Expected at least three prompts, got ${total}`)
  for (let round = 0; round < total; round += 1) {
    let answered = false
    for (let index = 0; index < 3; index += 1) {
      await page.locator('.target-option:not([disabled])').nth(index).click()
      if (await page.locator('[data-action="advance-round"]').count()) {
        answered = true
        break
      }
    }
    assert(answered, `Could not answer round ${round + 1}`)
    await page.locator('[data-action="advance-round"]').click()
  }
  await page.waitForSelector('.result-screen')
}
function hasMatch(board, size = 5) {
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size - 2; col += 1) {
      const a = board[row * size + col]
      if (a === board[row * size + col + 1] && a === board[row * size + col + 2]) return true
    }
  }
  for (let col = 0; col < size; col += 1) {
    for (let row = 0; row < size - 2; row += 1) {
      const a = board[row * size + col]
      if (a === board[(row + 1) * size + col] && a === board[(row + 2) * size + col]) return true
    }
  }
  return false
}
function findValidSwap(board, size = 5) {
  for (let index = 0; index < board.length; index += 1) {
    const candidates = []
    if (index % size < size - 1) candidates.push(index + 1)
    if (index < size * (size - 1)) candidates.push(index + size)
    for (const other of candidates) {
      const copy = [...board]
      ;[copy[index], copy[other]] = [copy[other], copy[index]]
      if (hasMatch(copy, size)) return [index, other]
    }
  }
  return null
}
async function finishMatch3(page) {
  const target = Number(await page.locator('.challenge-progress').getAttribute('aria-valuemax'))
  let attempts = 0
  while (!(await page.locator('.result-screen').count())) {
    if (attempts++ > 16) throw new Error('Match-three level did not reach its target')
    const progressBefore = Number(await page.locator('.challenge-progress').getAttribute('aria-valuenow'))
    if (progressBefore >= target) break
    const board = await page.locator('.match-tile').allInnerTexts()
    const swap = findValidSwap(board.map(value => value.trim()))
    if (!swap) throw new Error(`No valid match-3 move on attempt ${attempts}`)
    await page.locator(`.match-tile[data-match-cell="${swap[0]}"]`).click()
    await page.locator(`.match-tile[data-match-cell="${swap[1]}"]`).click()
    await page.waitForFunction(previous => {
      const current = Number(document.querySelector('.challenge-progress')?.getAttribute('aria-valuenow') ?? 0)
      return current > previous || Boolean(document.querySelector('.result-screen'))
    }, progressBefore)
  }
  await page.waitForSelector('.result-screen')
}
/** Traces along the guide track (blue-tinted pixels) row by row with the real mouse, or scribbles across the canvas. */
async function traceSymbol(page, scribble = false) {
  const before = Number(await page.locator('.challenge-progress').getAttribute('aria-valuenow'))
  const strokes = await page.evaluate(scribble => {
    const canvas = document.querySelector('.trace-canvas')
    const width = canvas.width
    const height = canvas.height
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
    const box = canvas.getBoundingClientRect()
    const client = (x, y) => [box.left + x / width * box.width, box.top + y / height * box.height]
    const out = []
    if (scribble) {
      for (let row = 0; row < 12; row += 1) out.push([client(2, row * height / 12), client(width - 2, row * height / 12 + height / 24)])
      return out
    }
    for (let y = 0; y < height; y += Math.round(height / 40)) {
      let start = -1
      for (let x = 0; x <= width; x += 1) {
        const i = (y * width + x) * 4
        const onTrack = x < width && data[i + 3] > 0 && data[i + 2] - data[i] > 25
        if (onTrack && start < 0) start = x
        if (!onTrack && start >= 0) {
          if (x - start > 3) out.push([client(start, y), client(x - 1, y)])
          start = -1
        }
      }
    }
    return out
  }, scribble)
  for (const [[x1, y1], [x2, y2]] of strokes) {
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move(x2, y2, { steps: 3 })
    await page.mouse.up()
  }
  await page.locator('[data-action="trace-check"]').click()
  if (scribble) return before
  await page.waitForFunction(previous => Number(document.querySelector('.challenge-progress')?.getAttribute('aria-valuenow') ?? 0) > previous || Boolean(document.querySelector('.result-screen')), before)
  return before
}
async function nextLevel(page, expectedId) {
  await page.locator('[data-action="next-level"]').click()
  await page.waitForSelector(`.play-screen[data-level-id="${expectedId}"]`)
}

try {
  await waitForServer()
  const routes = await (await fetch(`${url}manus-routes.json`)).json()
  if (routes.routes?.[0]?.path !== '/') throw new Error('Route manifest did not publish the home page')
  browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] }).catch(() => chromium.launch({ args: ['--ignore-gpu-blocklist'], channel: 'chrome' }))
  const errors = []
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' })
  const page = await openGame(desktop, errors)
  await page.screenshot({ path: `${out}/01-campaign-map-desktop.png` })
  assert(await page.locator('[data-level]').count() === 30, 'Campaign map should show all 30 levels')
  assert(await page.locator('.world-card').count() === 5, 'Campaign map should show five themed worlds')
  for (const title of ['數字果園', '注音森林', '國字小鎮', '綜合山道', '描寫彩虹路']) {
    assert(await page.getByText(title, { exact: true }).count() > 0, `Missing world ${title}`)
  }
  assert(!(await page.locator('[data-level="1"]').isDisabled()), 'First level should start unlocked')
  assert(await page.locator('[data-level="2"]').isDisabled(), 'Later levels should start locked')
  await page.locator('[data-action="teacher-unlock"]').click()
  assert(!(await page.locator('[data-level="30"]').isDisabled()), 'Teacher mode should open every level')
  await page.locator('[data-action="teacher-unlock"]').click()
  assert(await page.locator('[data-level="2"]').isDisabled(), 'Turning teacher mode off should restore step-by-step unlocking')
  const tweakCount = await page.evaluate(() => window.__game.tuning.controls.length)
  assert(tweakCount === 3, `Expected three live Tweak camera controls, got ${tweakCount}`)
  assert(await page.evaluate(() => window.__game.game.riderLoaded), 'The supplied bicycle-rider character did not load')
  assert(await page.evaluate(() => window.__game.game.learningSignCount) === 3, 'Expected three floating lesson signs')

  const mapVoice = page.locator('.map-screen [data-action="voice-toggle"]')
  assert(await mapVoice.getAttribute('aria-pressed') === 'true', 'Voice guidance should be enabled by default')
  const sound = page.locator('.map-screen [data-action="sound-toggle"]')
  await sound.click()
  assert(await page.locator('.map-screen [data-action="sound-toggle"]').getAttribute('aria-pressed') === 'false', 'Sound button did not mute music and effects')
  assert(await page.evaluate(() => localStorage.getItem('shuziyin.sound-enabled.v1')) === 'false', 'Muted sound preference was not saved')
  await page.locator('.map-screen [data-action="sound-toggle"]').click()
  assert(await page.locator('.map-screen [data-action="sound-toggle"]').getAttribute('aria-pressed') === 'true', 'Sound button did not re-enable music')

  await page.locator('[data-action="practice"]').click()
  await page.waitForSelector('.home-screen')
  assert(await page.locator('.practice-root .campaign-return').count() === 1, 'Classic practice must link back to the campaign map')
  await page.locator('.practice-root .campaign-return').click()
  await page.waitForSelector('.map-screen')

  await page.locator('[data-level="1"]').click()
  await page.waitForSelector('.play-screen[data-level-id="1"][data-campaign-mode="connect"]')
  const numberSky = await page.evaluate(() => { const sky = window.__game.game.scene.background; return sky.isColor ? sky.getHexString() : sky.uuid })
  assert(await page.locator('.challenge-heading').innerText().then(text => text.includes('數字果園') && text.includes('連連看')), 'Level 1 needs a number story and Connect mode')
  const intro = await page.evaluate(() => window.__speechLog[0])
  assert(intro?.text.includes('數字果園') && intro.lang === 'zh-TW', 'Campaign intro should use Traditional Chinese voice guidance')
  await page.waitForFunction(() => window.__game.audio.soundtrackRunning === true)
  await page.screenshot({ path: `${out}/02-connect-desktop.png` })

  const replayCount = await page.evaluate(() => window.__speechLog.length)
  await page.locator('[data-action="replay-guide"]').click()
  assert(await page.evaluate(() => window.__speechLog.length) === replayCount + 1, 'Replay guide should repeat the challenge narration')
  await page.locator('.play-screen [data-action="voice-toggle"]').click()
  assert(await page.locator('.play-screen [data-action="voice-toggle"]').getAttribute('aria-pressed') === 'false', 'Voice guidance toggle did not switch off')
  const mutedSpeechCount = await page.evaluate(() => window.__speechLog.length)
  await page.locator('[data-action="replay-guide"]').click()
  assert(await page.evaluate(() => window.__speechLog.length) === mutedSpeechCount, 'Voice replay should stay muted when voice guidance is off')
  await page.locator('.play-screen [data-action="voice-toggle"]').click()
  await page.locator('[data-action="replay-guide"]').click()
  assert(await page.evaluate(() => window.__speechLog.length) === mutedSpeechCount + 1, 'Voice replay should work after re-enabling guidance')

  const firstLeft = page.locator('.pair-card[data-pair-side="left"]:not([disabled])').first()
  const firstKey = await firstLeft.getAttribute('data-pair-key')
  await firstLeft.click()
  const wrongKey = await page.locator('.pair-card[data-pair-side="right"]').evaluateAll((cards, key) => cards.find(card => card.dataset.pairKey !== key)?.dataset.pairKey, firstKey)
  await page.locator(`.pair-card[data-pair-side="right"][data-pair-key="${wrongKey}"]`).click()
  assert((await page.locator('.campaign-feedback').innerText()).includes('換一張'), 'A mismatched pair should give gentle retry feedback')
  await page.screenshot({ path: `${out}/03-connect-retry-desktop.png` })
  await finishConnect(page)
  await page.screenshot({ path: `${out}/04-level-complete-desktop.png` })
  assert(await page.locator('[data-action="next-level"]').count() === 1, 'Completing a level should reveal the next level button')
  const savedProgress = await page.evaluate(() => JSON.parse(localStorage.getItem('shuziyin.campaign-progress.v1') ?? '{}'))
  assert(savedProgress['1'] >= 1, 'First level stars should persist locally')
  await page.locator('[data-action="back-map"]').click()
  await page.waitForSelector('.map-screen')
  assert(!(await page.locator('[data-level="2"]').isDisabled()), 'Completing level one should unlock level two')
  assert((await page.locator('.campaign-stars').innerText()).includes(String(savedProgress['1'])), 'Campaign map should display saved stars')
  await page.reload()
  await page.waitForSelector('.map-screen')
  assert(!(await page.locator('[data-level="2"]').isDisabled()), 'Unlocked level should remain available after reload')

  await page.locator('[data-level="2"]').click()
  await page.waitForSelector('.play-screen[data-level-id="2"]')
  assert(await page.locator('.play-screen').getAttribute('data-campaign-mode') === 'memory', 'Level 2 should use memory-pair gameplay')
  const memoryCards = page.locator('.memory-card')
  const firstMemoryKey = await memoryCards.first().getAttribute('data-pair-key')
  await memoryCards.first().click()
  await page.locator(`.memory-card[data-pair-key="${firstMemoryKey}"]:not(.is-open)`).first().click()
  await page.waitForFunction(key => [...document.querySelectorAll('.memory-card.is-matched')].some(card => card.getAttribute('data-pair-key') === key), firstMemoryKey)
  await finishMemory(page)
  await nextLevel(page, 3)
  assert(await page.locator('.play-screen').getAttribute('data-campaign-mode') === 'shoot', 'Level 3 should use friendly bubble-target shooting')
  await page.screenshot({ path: `${out}/05-bubble-target-desktop.png` })
  await finishRounds(page)
  await nextLevel(page, 4)
  assert(await page.locator('.play-screen').getAttribute('data-campaign-mode') === 'match3', 'Level 4 should use match-three gameplay')
  await page.screenshot({ path: `${out}/06-match-three-desktop.png` })
  await finishMatch3(page)
  await nextLevel(page, 5)
  await finishConnect(page)
  await nextLevel(page, 6)
  assert(await page.locator('.play-screen').getAttribute('data-campaign-mode') === 'relay', 'Level 6 should use the themed finish-line relay')
  await finishRounds(page)
  await page.locator('[data-action="back-map"]').click()
  await page.waitForSelector('.map-screen')
  assert(!(await page.locator('[data-level="7"]').isDisabled()), 'Finishing level six should unlock the Zhuyin world')
  await page.locator('[data-level="7"]').click()
  await page.waitForSelector('.play-screen[data-level-id="7"]')
  const zhuyinStory = await page.locator('.challenge-heading').innerText()
  assert(zhuyinStory.includes('注音森林') && zhuyinStory.includes('注音'), 'The second world should explain its Zhuyin learning challenge')
  const zhuyinSky = await page.evaluate(() => { const sky = window.__game.game.scene.background; return sky.isColor ? sky.getHexString() : sky.uuid })
  assert(zhuyinSky !== numberSky, 'Zhuyin and number campaign levels should select distinct scene lighting')
  await page.screenshot({ path: `${out}/07-zhuyin-world-desktop.png` })

  await page.locator('[data-action="back-map"]').click()
  await page.waitForSelector('.map-screen')
  await page.locator('[data-action="teacher-unlock"]').click()
  await page.locator('[data-level="28"]').click()
  await page.waitForSelector('.play-screen[data-level-id="28"][data-campaign-mode="trace"]')
  await page.waitForSelector('.trace-canvas')
  await page.locator('[data-action="trace-check"]').click()
  assert(await page.locator('.challenge-progress').getAttribute('aria-valuenow') === '0', 'An empty tracing canvas must not pass')
  await traceSymbol(page, true)
  assert(await page.locator('.challenge-progress').getAttribute('aria-valuenow') === '0', 'Scribbling over the whole canvas must not pass')
  await page.screenshot({ path: `${out}/10-trace-scribble-desktop.png` })
  await page.locator('[data-action="trace-clear"]').click()
  for (let symbol = 0; symbol < 3; symbol += 1) await traceSymbol(page)
  await page.waitForSelector('.result-screen')
  await page.locator('[data-action="back-map"]').click()
  await page.waitForSelector('.map-screen')
  await page.locator('[data-action="teacher-unlock"]').click()

  await desktop.close()
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW' })
  const phonePage = await openGame(phone, errors)
  assert(await phonePage.locator('[data-level]').count() === 30, 'Phone map should still expose all 30 levels')
  const mapHeight = await phonePage.locator('.campaign-map-scroll').evaluate(element => element.scrollHeight > element.clientHeight)
  assert(mapHeight, 'The four campaign worlds should scroll on a phone')
  await phonePage.screenshot({ path: `${out}/08-campaign-map-phone.png`, fullPage: true })
  await phonePage.locator('[data-level="1"]').tap()
  await phonePage.waitForSelector('.play-screen[data-level-id="1"]')
  await finishConnect(phonePage, true)
  await nextLevel(phonePage, 2)
  await phonePage.locator('.memory-card').first().tap()
  const phonePairKey = await phonePage.locator('.memory-card.is-open').getAttribute('data-pair-key')
  await phonePage.locator(`.memory-card[data-pair-key="${phonePairKey}"]:not(.is-open)`).first().tap()
  await phonePage.waitForFunction(key => [...document.querySelectorAll('.memory-card.is-matched')].some(card => card.getAttribute('data-pair-key') === key), phonePairKey)
  await phonePage.screenshot({ path: `${out}/09-memory-pairs-phone.png`, fullPage: true })
  await phone.close()

  if (errors.length) throw new Error(`console errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — campaign map, connect, memory, bubble shooting, match-three, relay, audio and phone touch, tracing; screenshots in ${out}/`)
} catch (error) {
  await fail(error?.message ?? String(error))
}
