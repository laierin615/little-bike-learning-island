import type { ActivityId } from './lessons'

export type CampaignTopic = ActivityId | 'mixed'
export type CampaignMode = 'connect' | 'memory' | 'shoot' | 'match3' | 'relay' | 'trace'

export type CampaignPair = {
  key: string
  left: string
  right: string
  learningNote: string
}

export type CampaignPrompt = {
  prompt: string
  picture: string
  pictureLabel: string
  choices: string[]
  answer: string
  explanation: string
}

export type CampaignLevel = {
  id: number
  world: number
  worldName: string
  topic: CampaignTopic
  mode: CampaignMode
  title: string
  story: string
  challenge: string
  color: string
  pairs: CampaignPair[]
  rounds: CampaignPrompt[]
  matchSymbols: string[]
  matchTarget: number
  /** Symbols to trace, in order, for `trace` levels; empty otherwise. */
  traceSymbols: string[]
}

const WORLD_DATA: Array<{
  topic: CampaignTopic
  name: string
  color: string
  icon: string
  story: string
  titles: [string, string, string, string, string, string]
}> = [
  {
    topic: 'numbers',
    name: '數字果園',
    color: '#e8336f',
    icon: '🍎',
    story: '穿過果樹和星星小徑，練習點數、認數字，幫腳踏車收集果園補給。',
    titles: ['果園圖卡連連看', '星星記憶配對', '泡泡數字靶場', '車輪數字消消樂', '果園長路連連看', '數字補給接力'],
  },
  {
    topic: 'zhuyin',
    name: '注音森林',
    color: '#11a37f',
    icon: '🔤',
    story: '沿著森林聽音小徑出發，看圖想想詞語的開頭聲音，認識注音符號。',
    titles: ['圖音連連看', '注音翻翻配對', '聲音泡泡靶場', '注音符號消消樂', '森林路標連線', '注音里程接力'],
  },
  {
    topic: 'characters',
    name: '國字小鎮',
    color: '#ec6a12',
    icon: '🏡',
    story: '騎進圖像小鎮，用日常圖畫記住簡單國字，沿路發現字形和意思的好朋友。',
    titles: ['圖字連連看', '漢字圖卡記憶', '國字泡泡靶場', '字形消消樂', '小鎮認字連線', '國字補給接力'],
  },
  {
    topic: 'mixed',
    name: '綜合山道',
    color: '#9645e0',
    icon: '⛰️',
    story: '最後騎上彩虹山道，交替複習數字、注音和國字，練習把一路學到的本領放在一起。',
    titles: ['跨島圖卡連線', '三科記憶卡', '綜合泡泡靶場', '混合符號消消樂', '三段路標連線', '終點大接力'],
  },
]

const MODE_ORDER: CampaignMode[] = ['connect', 'memory', 'shoot', 'match3', 'connect', 'relay']

const MODE_INSTRUCTIONS: Record<CampaignMode, string> = {
  connect: '先選一張左邊圖卡，再選右邊相配的卡片；找到所有好朋友就能通過。',
  memory: '翻開兩張記憶卡，記住看過的圖案，找出互相配對的學習卡。',
  shoot: '看清楚圖片和題目，點一下正確答案的泡泡靶；答錯也可以再試一次。',
  match3: '點一塊圖卡，再點旁邊的圖卡交換；排出三個相同符號即可消除。',
  relay: '完成沿路的小題，替腳踏車收集補給星星，一起騎到終點。',
  trace: '用手指沿著虛線慢慢描，描完按「寫好了」；描不夠也沒關係，可以擦掉重寫。',
}

const PAIRS: Record<CampaignTopic, CampaignPair[]> = {
  numbers: [
    { key: 'n2', left: '🍎　🍎', right: '2', learningNote: '兩顆蘋果配數字 2。' },
    { key: 'n3', left: '⭐　⭐　⭐', right: '3', learningNote: '三顆星星配數字 3。' },
    { key: 'n4', left: '🍓　🍓　🍓　🍓', right: '4', learningNote: '四顆草莓配數字 4。' },
    { key: 'n5', left: '🐟　🐟　🐟　🐟　🐟', right: '5', learningNote: '五條小魚配數字 5。' },
    { key: 'n6', left: '🌼　🌼　🌼　🌼　🌼　🌼', right: '6', learningNote: '六朵小花配數字 6。' },
    { key: 'n7', left: '🫐　🫐　🫐　🫐　🫐　🫐　🫐', right: '7', learningNote: '七顆藍莓配數字 7。' },
  ],
  zhuyin: [
    { key: 'z-m', left: '🐱　貓咪', right: 'ㄇ', learningNote: '貓咪的第一個注音是 ㄇ。' },
    { key: 'z-g', left: '🐶　狗狗', right: 'ㄍ', learningNote: '狗狗的第一個注音是 ㄍ。' },
    { key: 'z-y', left: '🐟　小魚', right: 'ㄩ', learningNote: '魚的第一個注音是 ㄩ。' },
    { key: 'z-h', left: '🌸　花朵', right: 'ㄏ', learningNote: '花朵的第一個注音是 ㄏ。' },
    { key: 'z-s', left: '✋　手掌', right: 'ㄕ', learningNote: '手掌的第一個注音是 ㄕ。' },
    { key: 'z-q', left: '⚽　球球', right: 'ㄑ', learningNote: '球球的第一個注音是 ㄑ。' },
  ],
  characters: [
    { key: 'c-sun', left: '☀️　太陽', right: '日', learningNote: '太陽像「日」，白天會看到日。' },
    { key: 'c-mountain', left: '⛰️　高山', right: '山', learningNote: '山峰高高低低，這個字是「山」。' },
    { key: 'c-water', left: '💧　水滴', right: '水', learningNote: '水滴就是「水」。' },
    { key: 'c-tree', left: '🌳　大樹', right: '木', learningNote: '樹木的木頭就是「木」。' },
    { key: 'c-fire', left: '🔥　火焰', right: '火', learningNote: '火焰會發光發熱，這個字是「火」。' },
    { key: 'c-moon', left: '🌙　月亮', right: '月', learningNote: '夜晚看到月亮，記住「月」。' },
  ],
  mixed: [
    { key: 'm-n3', left: '⭐　⭐　⭐', right: '3', learningNote: '三顆星星配數字 3。' },
    { key: 'm-zm', left: '🐱　貓咪', right: 'ㄇ', learningNote: '貓咪的第一個注音是 ㄇ。' },
    { key: 'm-csun', left: '☀️　太陽', right: '日', learningNote: '太陽像「日」。' },
    { key: 'm-n5', left: '🍓　🍓　🍓　🍓　🍓', right: '5', learningNote: '五顆草莓配數字 5。' },
    { key: 'm-zg', left: '🐶　狗狗', right: 'ㄍ', learningNote: '狗狗的第一個注音是 ㄍ。' },
    { key: 'm-cwater', left: '💧　水滴', right: '水', learningNote: '水滴就是「水」。' },
  ],
}

const NUMBER_ROUNDS: CampaignPrompt[] = [
  { prompt: '數一數，有幾顆蘋果？', picture: '🍎　🍎', pictureLabel: '兩顆蘋果', choices: ['1', '2', '3'], answer: '2', explanation: '一起數：一、二，兩顆蘋果是 2。' },
  { prompt: '數一數，有幾顆星星？', picture: '⭐　⭐　⭐', pictureLabel: '三顆星星', choices: ['2', '3', '4'], answer: '3', explanation: '三顆星星，對應數字 3。' },
  { prompt: '數一數，有幾顆草莓？', picture: '🍓　🍓　🍓　🍓', pictureLabel: '四顆草莓', choices: ['3', '4', '5'], answer: '4', explanation: '四顆草莓，對應數字 4。' },
  { prompt: '池塘裡有幾條小魚？', picture: '🐟　🐟　🐟　🐟　🐟', pictureLabel: '五條小魚', choices: ['4', '5', '6'], answer: '5', explanation: '慢慢數一數，五條小魚就是 5。' },
  { prompt: '數一數，有幾朵小花？', picture: '🌼　🌼　🌼　🌼　🌼　🌼', pictureLabel: '六朵小花', choices: ['5', '6', '7'], answer: '6', explanation: '六朵小花，對應數字 6。' },
  { prompt: '數一數，有幾片葉子？', picture: '🍃　🍃　🍃　🍃　🍃　🍃　🍃', pictureLabel: '七片葉子', choices: ['6', '7', '8'], answer: '7', explanation: '一起點數七片葉子，答案是 7。' },
  { prompt: '數一數，有幾顆橘子？', picture: '🍊　🍊　🍊　🍊　🍊　🍊　🍊　🍊', pictureLabel: '八顆橘子', choices: ['7', '8', '9'], answer: '8', explanation: '八顆橘子，對應數字 8。' },
  { prompt: '哪個數字代表一顆球？', picture: '⚽', pictureLabel: '一顆球', choices: ['1', '2', '3'], answer: '1', explanation: '只有一顆球，對應數字 1。' },
]

const ZHUYIN_ROUNDS: CampaignPrompt[] = [
  { prompt: '「貓咪」的第一個注音是什麼？', picture: '🐱', pictureLabel: '貓咪', choices: ['ㄅ', 'ㄇ', 'ㄍ'], answer: 'ㄇ', explanation: '貓咪的第一個注音是 ㄇ。' },
  { prompt: '「狗狗」的第一個注音是什麼？', picture: '🐶', pictureLabel: '狗狗', choices: ['ㄍ', 'ㄇ', 'ㄑ'], answer: 'ㄍ', explanation: '狗狗的第一個注音是 ㄍ。' },
  { prompt: '「魚」的第一個注音是什麼？', picture: '🐟', pictureLabel: '小魚', choices: ['ㄆ', 'ㄩ', 'ㄍ'], answer: 'ㄩ', explanation: '魚的第一個注音是 ㄩ。' },
  { prompt: '「花朵」的第一個注音是什麼？', picture: '🌸', pictureLabel: '花朵', choices: ['ㄏ', 'ㄔ', 'ㄍ'], answer: 'ㄏ', explanation: '花朵的第一個注音是 ㄏ。' },
  { prompt: '「手掌」的第一個注音是什麼？', picture: '✋', pictureLabel: '手掌', choices: ['ㄕ', 'ㄅ', 'ㄇ'], answer: 'ㄕ', explanation: '手掌的第一個注音是 ㄕ。' },
  { prompt: '「球球」的第一個注音是什麼？', picture: '⚽', pictureLabel: '球球', choices: ['ㄑ', 'ㄐ', 'ㄎ'], answer: 'ㄑ', explanation: '球球的第一個注音是 ㄑ。' },
  { prompt: '「太陽」的第一個注音是什麼？', picture: '☀️', pictureLabel: '太陽', choices: ['ㄊ', 'ㄉ', 'ㄋ'], answer: 'ㄊ', explanation: '太陽的第一個注音是 ㄊ。' },
  { prompt: '「西瓜」的第一個注音是什麼？', picture: '🍉', pictureLabel: '西瓜', choices: ['ㄒ', 'ㄍ', 'ㄓ'], answer: 'ㄒ', explanation: '西瓜的第一個注音是 ㄒ。' },
]

const CHARACTER_ROUNDS: CampaignPrompt[] = [
  { prompt: '看圖找一找，太陽是哪個字？', picture: '☀️', pictureLabel: '太陽', choices: ['日', '月', '山'], answer: '日', explanation: '太陽像「日」，白天會看到日。' },
  { prompt: '看圖找一找，高高的山是哪個字？', picture: '⛰️', pictureLabel: '高山', choices: ['水', '山', '木'], answer: '山', explanation: '山峰高高低低，這個字是「山」。' },
  { prompt: '看圖找一找，水滴是哪個字？', picture: '💧', pictureLabel: '水滴', choices: ['火', '水', '日'], answer: '水', explanation: '水滴就是「水」。' },
  { prompt: '看圖找一找，大樹是哪個字？', picture: '🌳', pictureLabel: '大樹', choices: ['木', '月', '水'], answer: '木', explanation: '樹木的木頭就是「木」。' },
  { prompt: '看圖找一找，火焰是哪個字？', picture: '🔥', pictureLabel: '火焰', choices: ['山', '火', '日'], answer: '火', explanation: '火焰會發光發熱，這個字是「火」。' },
  { prompt: '看圖找一找，月亮是哪個字？', picture: '🌙', pictureLabel: '月亮', choices: ['月', '木', '火'], answer: '月', explanation: '夜晚看到月亮，記住「月」。' },
  { prompt: '嘴巴是哪個字？', picture: '👄', pictureLabel: '嘴巴', choices: ['口', '人', '大'], answer: '口', explanation: '張開的嘴巴像「口」。' },
  { prompt: '看圖想一想，小小的螞蟻是哪個字？', picture: '🐜', pictureLabel: '小螞蟻', choices: ['小', '大', '木'], answer: '小', explanation: '小螞蟻很小，記住「小」這個字。' },
]

const ROUND_BANK: Record<CampaignTopic, CampaignPrompt[]> = {
  numbers: NUMBER_ROUNDS,
  zhuyin: ZHUYIN_ROUNDS,
  characters: CHARACTER_ROUNDS,
  mixed: [...NUMBER_ROUNDS.slice(0, 3), ...ZHUYIN_ROUNDS.slice(0, 3), ...CHARACTER_ROUNDS.slice(0, 3)],
}

const MATCH_SYMBOLS: Record<CampaignTopic, string[]> = {
  numbers: ['1', '2', '3', '4'],
  zhuyin: ['ㄅ', 'ㄇ', 'ㄍ', 'ㄏ'],
  characters: ['日', '山', '水', '木'],
  mixed: ['2', 'ㄇ', '日', '3'],
}

function roundsFor(topic: CampaignTopic, levelId: number, count: number): CampaignPrompt[] {
  const bank = ROUND_BANK[topic]
  const start = topic === 'mixed' ? (levelId * 2) % bank.length : (levelId - 1) % bank.length
  return Array.from({ length: count }, (_, index) => bank[(start + index) % bank.length])
}

const WORDING: Record<CampaignTopic, { matching: string; symbol: string }> = {
  numbers: { matching: '水果數量和數字', symbol: '數字' },
  zhuyin: { matching: '圖片和第一個注音', symbol: '注音符號' },
  characters: { matching: '生活圖片和簡單國字', symbol: '國字' },
  mixed: { matching: '數字、注音和國字圖卡', symbol: '不同的學習符號' },
}

const PAIR_COUNT_BY_STOP = [3, 3, 3, 3, 4, 4]

export const CAMPAIGN_LEVELS: CampaignLevel[] = WORLD_DATA.flatMap((world, worldIndex) =>
  MODE_ORDER.map((mode, stopIndex) => {
    const id = worldIndex * 6 + stopIndex + 1
    const pairCount = PAIR_COUNT_BY_STOP[stopIndex]
    const wording = WORDING[world.topic]
    const challenge = mode === 'connect'
      ? `把${wording.matching}連起來。${stopIndex === 4 ? '這一站圖卡更多，慢慢觀察再配對。' : '每完成一組，就替單車收集一顆星。'}`
      : mode === 'memory'
        ? `翻開兩張記憶卡，找到${wording.matching}的好朋友。卡片不會倒數，放心想一想。`
        : mode === 'shoot'
          ? `看提示，點中正確的${wording.symbol}泡泡靶。每題都能重試，答對就繼續前進。`
          : mode === 'match3'
            ? `交換相鄰圖塊，排出三個相同的${wording.symbol}。沒有倒數，慢慢找出好走法。`
            : `完成 ${world.topic === 'mixed' ? '數字、注音和國字' : wording.symbol}小題，替腳踏車裝滿補給，騎向終點。`
    const pairBank = PAIRS[world.topic]
    const pairs = Array.from({ length: pairCount }, (_, index) => pairBank[(index + worldIndex) % pairBank.length])
    const roundCount = mode === 'relay' ? 5 : 4
    const matchTarget = Math.min(4, 2 + worldIndex + (stopIndex === 3 ? 1 : 0))

    return {
      id,
      world: worldIndex + 1,
      worldName: world.name,
      topic: world.topic,
      mode,
      title: world.titles[stopIndex],
      story: `${world.story} 第 ${stopIndex + 1} 站：${challenge}`,
      challenge: MODE_INSTRUCTIONS[mode],
      color: world.color,
      pairs,
      rounds: roundsFor(world.topic, id, roundCount),
      matchSymbols: MATCH_SYMBOLS[world.topic],
      matchTarget,
      traceSymbols: [],
    }
  }),
)

/** World 5 (levels 25–30): tracing numbers and Zhuyin along the rainbow road. */
const TRACE_WORLD = {
  name: '描寫彩虹路',
  color: '#2f86e8',
  icon: '✏️',
  story: '沿著彩虹路，用手指描一描，把數字和注音寫得漂漂亮亮。',
}
const TRACE_STOPS: Array<{ topic: CampaignTopic; title: string; symbols: string[] }> = [
  { topic: 'numbers', title: '數字描描 1 2 3', symbols: ['1', '2', '3'] },
  { topic: 'numbers', title: '數字描描 4 5 6', symbols: ['4', '5', '6'] },
  { topic: 'numbers', title: '數字描描 7 8 9', symbols: ['7', '8', '9'] },
  { topic: 'zhuyin', title: '注音描描 ㄅㄆㄇ', symbols: ['ㄅ', 'ㄆ', 'ㄇ'] },
  { topic: 'zhuyin', title: '注音描描 ㄈㄉㄊ', symbols: ['ㄈ', 'ㄉ', 'ㄊ'] },
  { topic: 'zhuyin', title: '注音描描 ㄋㄌㄍ', symbols: ['ㄋ', 'ㄌ', 'ㄍ'] },
]
CAMPAIGN_LEVELS.push(...TRACE_STOPS.map((stop, stopIndex): CampaignLevel => {
  const kind = stop.topic === 'numbers' ? '數字' : '注音'
  return {
    id: WORLD_DATA.length * 6 + stopIndex + 1,
    world: WORLD_DATA.length + 1,
    worldName: TRACE_WORLD.name,
    topic: stop.topic,
    mode: 'trace',
    title: stop.title,
    story: `${TRACE_WORLD.story} 第 ${stopIndex + 1} 站：描寫${kind} ${stop.symbols.join('、')}，每個符號描完就收集一顆星。`,
    challenge: MODE_INSTRUCTIONS.trace,
    color: TRACE_WORLD.color,
    pairs: [],
    rounds: [],
    matchSymbols: [],
    matchTarget: 0,
    traceSymbols: stop.symbols,
  }
}))

export const CAMPAIGN_WORLDS = [...WORLD_DATA, TRACE_WORLD].map((world, index) => ({
  id: index + 1,
  name: world.name,
  color: world.color,
  icon: world.icon,
  description: world.story,
  levels: CAMPAIGN_LEVELS.filter(level => level.world === index + 1),
}))

export function getCampaignLevel(id: number): CampaignLevel {
  const level = CAMPAIGN_LEVELS[id - 1]
  if (!level || level.id !== id) throw new Error(`Unknown campaign level: ${id}`)
  return level
}

export function getModeLabel(mode: CampaignMode): string {
  const labels: Record<CampaignMode, string> = {
    connect: '連連看',
    memory: '記憶配對',
    shoot: '泡泡射擊',
    match3: '消消樂',
    relay: '接力挑戰',
    trace: '描寫',
  }
  return labels[mode]
}

/** Choices in a fresh random order, so the right answer is not always in the same spot. */
export function shuffleChoices(choices: readonly string[], random: () => number = Math.random): string[] {
  const result = [...choices]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}
