import { describe, expect, it } from 'vitest'
import { ACTIVITIES, answerIsCorrect } from '../src/game/lessons'

describe('learning activities', () => {
  it('provides separate number, Zhuyin and picture-assisted character levels', () => {
    expect(ACTIVITIES.map(activity => activity.id)).toEqual(['numbers', 'zhuyin', 'characters'])
    expect(ACTIVITIES.every(activity => activity.questions.length >= 5)).toBe(true)
  })

  it('describes each learning trip in clear Traditional Chinese', () => {
    const numbers = ACTIVITIES.find(activity => activity.id === 'numbers')!
    const zhuyin = ACTIVITIES.find(activity => activity.id === 'zhuyin')!
    const characters = ACTIVITIES.find(activity => activity.id === 'characters')!
    expect(numbers.description).toContain('數一數')
    expect(numbers.description).toContain('正確數字')
    expect(zhuyin.description).toContain('第一個注音')
    expect(characters.description).toContain('簡單漢字')
  })

  it('gives every question a valid set of three choices and one correct answer', () => {
    for (const activity of ACTIVITIES) {
      for (const question of activity.questions) {
        expect(question.choices).toHaveLength(3)
        expect(new Set(question.choices).size).toBe(3)
        expect(question.choices).toContain(question.answer)
        expect(answerIsCorrect(question, question.answer)).toBe(true)
        expect(answerIsCorrect(question, question.choices.find(choice => choice !== question.answer)!)).toBe(false)
        expect(question.memoryTip.length).toBeGreaterThan(0)
        expect(question.pictureLabel.length).toBeGreaterThan(0)
      }
    }
  })

  it('uses visible image cues and memory tips for the simple-character level', () => {
    const characters = ACTIVITIES.find(activity => activity.id === 'characters')!
    expect(characters.questions.every(question => question.picture && question.word && question.answer.length === 1)).toBe(true)
    expect(characters.questions.map(question => question.answer)).toEqual(['日', '山', '水', '木', '火', '月'])
  })
})
