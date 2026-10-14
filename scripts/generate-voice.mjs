// Generates the recorded narration in public/voice/ with Gemini text-to-speech.
//
//   GEMINI_API_KEY=... node scripts/generate-voice.mjs --samples        # 3 lines × several voices → voice-samples/
//   GEMINI_API_KEY=... node scripts/generate-voice.mjs --voice Leda     # every line the game speaks → public/voice/
//
// The key is read only from the environment and is never written to disk. Existing clips are
// skipped, so re-running after editing game text only records the new sentences. Needs ffmpeg.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Work from the project root no matter which folder the command is run from.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

/** Asks for the key in the terminal without echoing it; it stays in memory only. */
function askHidden(question) {
  return new Promise(done => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(text) }
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); done(answer.trim()) })
  })
}

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const samples = args.includes('--samples')
const voiceName = option('--voice', 'Leda')
const model = option('--model', process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts')
let key = process.env.GEMINI_API_KEY?.trim() ?? ''
if (!/^[\w-]{30,}$/.test(key)) {
  if (!process.stdin.isTTY) {
    console.error('找不到有效的 GEMINI_API_KEY，請在終端機直接執行這支程式，它會請你貼上金鑰。')
    process.exit(1)
  }
  key = await askHidden('請貼上 Gemini 金鑰後按 Enter（畫面不會顯示）：')
  if (!/^[\w-]{30,}$/.test(key)) {
    console.error('這看起來不是 Gemini 金鑰（通常是 AIza 開頭的一長串英數字），請再試一次。')
    process.exit(1)
  }
}

const STYLE = '請用台灣華語，像溫柔、可愛又有活力的幼兒園老師對大班小朋友說話，語速稍慢、咬字清楚、帶著微笑，自然地念出下面這句話，不要加任何其他字：'

async function synthesize(text, voice) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE}\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    })
    if (response.status === 429 || response.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt))
      continue
    }
    if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const json = await response.json()
    const data = json.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData?.data
    if (!data) throw new Error(`Gemini 沒有回傳音訊：${JSON.stringify(json).slice(0, 300)}`)
    return Buffer.from(data, 'base64')
  }
  throw new Error('Gemini 一直回應忙碌，請稍後再試。')
}

/** 24 kHz 16-bit mono PCM → trimmed, normalised 48 kbps MP3. */
function toMp3(pcm, path) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5',
      '-ar', '24000', '-b:a', '48k', path])
    ffmpeg.on('error', reject)
    ffmpeg.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
    ffmpeg.stdin.end(pcm)
  })
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const lines = await server.ssrLoadModule('/src/game/speech-lines.ts')
await server.close()

if (samples) {
  mkdirSync('voice-samples', { recursive: true })
  const texts = ['數字果園。第 1 關，果園圖卡連連看。', '答對了！太好了，騎到下一個路標！', '差一點！再看看圖，換一個泡泡試試看。']
  for (const voice of ['Leda', 'Aoede', 'Kore', 'Puck']) {
    for (const [index, text] of texts.entries()) {
      await toMp3(await synthesize(text, voice), `voice-samples/${voice}-${index + 1}.mp3`)
      console.log(`✓ ${voice} ${index + 1}`)
    }
  }
  console.log('試聽檔在 voice-samples/，選好聲音後執行：node scripts/generate-voice.mjs --voice <名稱>')
  process.exit(0)
}

const outDir = 'public/voice'
mkdirSync(outDir, { recursive: true })
const manifestPath = `${outDir}/manifest.json`
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const segments = lines.allSpeechSegments()
const done = new Set(previous?.voice === voiceName ? previous.clips : [])
const todo = segments.filter(segment => !done.has(lines.segmentKey(segment)) || !existsSync(`${outDir}/${lines.segmentKey(segment)}.mp3`))
console.log(`共 ${segments.length} 句，需要錄製 ${todo.length} 句（聲音：${voiceName}）`)

let finished = 0
const failures = []
async function worker() {
  while (todo.length > 0) {
    const segment = todo.shift()
    const clipKey = lines.segmentKey(segment)
    try {
      await toMp3(await synthesize(segment, voiceName), `${outDir}/${clipKey}.mp3`)
      done.add(clipKey)
    } catch (error) {
      failures.push(`${segment}：${error.message}`)
    }
    finished += 1
    if (finished % 20 === 0) console.log(`… ${finished} 句完成`)
  }
}
await Promise.all(Array.from({ length: 4 }, worker))

const valid = segments.map(lines.segmentKey).filter(clipKey => done.has(clipKey) && existsSync(`${outDir}/${clipKey}.mp3`))
writeFileSync(manifestPath, `${JSON.stringify({ voice: voiceName, model, clips: valid }, null, 2)}\n`)
console.log(`完成：${valid.length} / ${segments.length} 句有錄音。`)
if (failures.length > 0) {
  console.log(`有 ${failures.length} 句失敗，遊戲會改用裝置語音念這些句子；可再執行一次補錄：`)
  for (const failure of failures.slice(0, 10)) console.log(`  - ${failure}`)
}
