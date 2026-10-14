import { CAMPAIGN_LEVELS, type CampaignLevel, type CampaignPair, type CampaignPrompt } from './campaign'
import { ACTIVITIES, type Activity, type LessonQuestion } from './lessons'

/**
 * Every sentence the game reads aloud is built here, so the UI and the recorded-voice
 * generator (`scripts/generate-voice.mjs`) always agree on the exact wording.
 */
export const FEEDBACK = {
  connectWrong: '這兩張還不是好朋友，換一張再找找看！',
  memoryWrong: '先看一看這兩張，再試著記住位置。慢慢來！',
  bubbleWrong: '差一點！再看看圖，換一個泡泡試試看。',
  matchNoLine: '還沒排成三個相同符號，沒關係，再試另一條路！',
  matchCleared: '消除成功！單車再前進一段路。',
  practiceWrong: '看看路邊的圖卡，再慢慢想一想。不用急，還可以再試！',
  traceEmpty: '先用手指在虛線上描一描，再按寫好了。',
  traceMore: '再沿著虛線多描一點點，你可以的！',
  traceOff: '筆畫跑出虛線了，擦掉再慢慢描一次。',
} as const

export const roundSpeech = (round: CampaignPrompt, choices: readonly string[] = round.choices) => `${round.prompt}。答案選項：${choices.join('、')}。`
export const levelGuide = (level: CampaignLevel, roundText = '') => `${level.worldName}。第 ${level.id} 關，${level.title}。${level.challenge}${roundText}`
export const levelComplete = (level: CampaignLevel, stars: number) => `太棒了！完成${level.title}，獲得 ${stars} 顆星。騎到終點啦！`
export const connectCorrect = (pair: CampaignPair) => `連對了！${pair.learningNote}`
export const memoryCorrect = (pair: CampaignPair) => `配對成功！${pair.learningNote}`
export const bubbleCorrect = (round: CampaignPrompt) => `答對了！${round.explanation}`
const traceKind = (level: CampaignLevel) => (level.topic === 'numbers' ? '數字' : '注音')
export const traceStart = (level: CampaignLevel, symbol: string) => `請用手指沿著虛線，描寫${traceKind(level)} ${symbol}。`
export const traceGood = (level: CampaignLevel, symbol: string) => `寫得真棒！${traceKind(level)} ${symbol} 描好了。`

export const practiceQuestion = (question: LessonQuestion, index: number, choices: readonly string[] = question.choices) => `第 ${index + 1} 題。${question.prompt}。答案選項：${choices.join('、')}。`
export const practiceIntro = (activity: Activity, index: number, choices?: readonly string[]) => `${activity.title}。${activity.description}。${practiceQuestion(activity.questions[index], index, choices)}`
export const practiceCorrect = (question: LessonQuestion) => `答對了！${question.memoryTip}。太好了，騎到下一個路標！`
export const practiceComplete = (activity: Activity) => `太棒了！你完成了${activity.title}，騎到終點啦！`

/** Text as it is actually voiced: no emoji, single spaces. */
export function normalizeSpeech(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/️/g, '').replace(/\s+/g, ' ').trim()
}

/** Splits narration into sentence-sized clips so recordings can be reused across lines. */
export function speechSegments(text: string): string[] {
  return normalizeSpeech(text).split(/(?<=[。！？!?])/u).map(part => part.trim()).filter(part => part.length > 0)
}

/** Stable file key for a clip (FNV-1a, hex). */
export function segmentKey(segment: string): string {
  let hash = 0x811c9dc5
  for (const character of segment) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Every ordering of a short choice list (choices are shuffled on screen and read in that order). */
function orderings<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) => orderings([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]))
}

/** All narration the game can produce, split into unique clips. */
export function allSpeechSegments(): string[] {
  const lines: string[] = Object.values(FEEDBACK)
  for (const level of CAMPAIGN_LEVELS) {
    lines.push(levelGuide(level))
    for (const round of level.rounds) lines.push(...orderings(round.choices).map(order => roundSpeech(round, order)), bubbleCorrect(round))
    for (const symbol of level.traceSymbols) lines.push(traceStart(level, symbol), traceGood(level, symbol))
    for (const pair of level.pairs) lines.push(connectCorrect(pair), memoryCorrect(pair))
    for (const stars of [1, 2, 3]) lines.push(levelComplete(level, stars))
  }
  for (const activity of ACTIVITIES) {
    activity.questions.forEach((question, index) => {
      for (const order of orderings(question.choices)) lines.push(practiceIntro(activity, index, order))
      lines.push(practiceCorrect(question))
    })
    lines.push(practiceComplete(activity))
  }
  return [...new Set(lines.flatMap(speechSegments))]
}
