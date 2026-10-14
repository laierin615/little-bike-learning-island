export type ActivityId = 'numbers' | 'zhuyin' | 'characters'

export type LessonQuestion = {
  prompt: string
  picture: string
  pictureLabel: string
  word?: string
  objects?: string[]
  choices: string[]
  answer: string
  memoryTip: string
}

export type Activity = {
  id: ActivityId
  title: string
  subtitle: string
  description: string
  icon: string
  color: string
  pictureLabel: string
  questions: LessonQuestion[]
}

export const ACTIVITIES: Activity[] = [
  {
    id: 'numbers',
    title: '數字果園',
    subtitle: '騎到果園數一數，再選出數字',
    description: '在數字果園幫忙採收：數一數圖片裡的水果與星星，再選出正確數字。答對一道題，騎士就會前進到下一個路標。',
    icon: '🍎',
    color: '#e8336f',
    pictureLabel: '數量圖卡',
    questions: [
      { prompt: '數一數，有幾顆蘋果？', picture: '🍎', pictureLabel: '紅蘋果', objects: ['🍎', '🍎', '🍎'], choices: ['2', '3', '4'], answer: '3', memoryTip: '一顆、兩顆、三顆蘋果，答案是 3。' },
      { prompt: '數一數，天空有幾顆星星？', picture: '⭐', pictureLabel: '星星', objects: ['⭐', '⭐', '⭐', '⭐', '⭐'], choices: ['4', '5', '6'], answer: '5', memoryTip: '一起點數：1、2、3、4、5，答案是 5。' },
      { prompt: '數一數，有幾顆草莓？', picture: '🍓', pictureLabel: '草莓', objects: ['🍓', '🍓', '🍓', '🍓'], choices: ['3', '4', '5'], answer: '4', memoryTip: '四顆草莓排在一起，答案是 4。' },
      { prompt: '數一數，池塘裡有幾條小魚？', picture: '🐟', pictureLabel: '小魚', objects: ['🐟', '🐟', '🐟', '🐟', '🐟', '🐟'], choices: ['5', '6', '7'], answer: '6', memoryTip: '慢慢數一數，六條小魚就是 6。' },
      { prompt: '數一數，有幾朵小花？', picture: '🌼', pictureLabel: '小花', objects: ['🌼', '🌼', '🌼', '🌼', '🌼', '🌼', '🌼'], choices: ['6', '7', '8'], answer: '7', memoryTip: '七朵小花，對應數字 7。' },
    ],
  },
  {
    id: 'zhuyin',
    title: '注音森林',
    subtitle: '騎進森林，看圖找第一個注音',
    description: '騎進注音森林，先看圖想想詞語開頭的聲音，再選出第一個注音。每答對一題，就前進到下一個森林路標。',
    icon: '🔤',
    color: '#11a37f',
    pictureLabel: '圖片提示',
    questions: [
      { prompt: '「貓咪」的第一個注音是什麼？', picture: '🐱', pictureLabel: '貓咪', word: '貓咪', choices: ['ㄅ', 'ㄇ', 'ㄍ'], answer: 'ㄇ', memoryTip: '貓咪的第一個注音是 ㄇ。' },
      { prompt: '「狗狗」的第一個注音是什麼？', picture: '🐶', pictureLabel: '狗狗', word: '狗狗', choices: ['ㄍ', 'ㄇ', 'ㄑ'], answer: 'ㄍ', memoryTip: '狗狗的第一個注音是 ㄍ。' },
      { prompt: '「魚」的第一個注音是什麼？', picture: '🐟', pictureLabel: '小魚', word: '魚', choices: ['ㄆ', 'ㄩ', 'ㄍ'], answer: 'ㄩ', memoryTip: '魚的第一個注音是 ㄩ。' },
      { prompt: '「花朵」的第一個注音是什麼？', picture: '🌸', pictureLabel: '花朵', word: '花朵', choices: ['ㄏ', 'ㄔ', 'ㄍ'], answer: 'ㄏ', memoryTip: '花朵的第一個注音是 ㄏ。' },
      { prompt: '「手掌」的第一個注音是什麼？', picture: '✋', pictureLabel: '手掌', word: '手掌', choices: ['ㄕ', 'ㄅ', 'ㄇ'], answer: 'ㄕ', memoryTip: '手掌的第一個注音是 ㄕ。' },
    ],
  },
  {
    id: 'characters',
    title: '圖像認字屋',
    subtitle: '騎到認字小屋，看圖記住簡單漢字',
    description: '騎到認字小屋，將圖片和簡單漢字連起來。想一想圖像特徵，就能把字記得更牢。',
    icon: '🖼️',
    color: '#ec6a12',
    pictureLabel: '圖片記憶卡',
    questions: [
      { prompt: '看圖找一找，「太陽」是哪個字？', picture: '☀️', pictureLabel: '太陽', word: '太陽', choices: ['日', '月', '山'], answer: '日', memoryTip: '☀️ 太陽像「日」，白天會看到日。' },
      { prompt: '看圖找一找，高高的山是哪個字？', picture: '⛰️', pictureLabel: '高山', word: '高高的山', choices: ['水', '山', '木'], answer: '山', memoryTip: '⛰️ 山峰高高低低，記住「山」這個字。' },
      { prompt: '看圖找一找，清清的水是哪個字？', picture: '💧', pictureLabel: '水滴', word: '水滴', choices: ['火', '水', '日'], answer: '水', memoryTip: '💧 水滴就是「水」，看到水就想起這個字。' },
      { prompt: '看圖找一找，大樹是哪個字？', picture: '🌳', pictureLabel: '大樹', word: '大樹', choices: ['木', '月', '水'], answer: '木', memoryTip: '🌳 樹木的木頭就是「木」。' },
      { prompt: '看圖找一找，火焰是哪個字？', picture: '🔥', pictureLabel: '火焰', word: '火焰', choices: ['山', '火', '日'], answer: '火', memoryTip: '🔥 火焰會發光發熱，這個字是「火」。' },
      { prompt: '看圖找一找，夜晚的月亮是哪個字？', picture: '🌙', pictureLabel: '月亮', word: '月亮', choices: ['月', '木', '火'], answer: '月', memoryTip: '🌙 夜晚看到月亮，記住「月」這個字。' },
    ],
  },
]

export function getActivity(id: ActivityId): Activity {
  const activity = ACTIVITIES.find(item => item.id === id)
  if (!activity) throw new Error(`Unknown activity: ${id}`)
  return activity
}

export function answerIsCorrect(question: LessonQuestion, choice: string): boolean {
  return question.choices.includes(choice) && choice === question.answer
}
