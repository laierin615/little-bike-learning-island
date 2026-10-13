import { describe, expect, it } from 'vitest'
import { CAMPAIGN_LEVELS, getCampaignLevel } from '../src/game/campaign'
import {
  CAMPAIGN_LEVEL_COUNT,
  collapseAndRefillMatches,
  createMatchBoard,
  findMatches,
  isLevelUnlocked,
  parseCampaignProgress,
  recordLevelStars,
  starsForMistakes,
  totalCampaignStars,
  tryMatchSwap,
} from '../src/game/campaign-rules'

describe('24-level bicycle campaign', () => {
  it('contains four six-stop worlds in a consecutive 24-level route', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(CAMPAIGN_LEVEL_COUNT)
    expect(CAMPAIGN_LEVELS.map(level => level.id)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    for (let world = 1; world <= 4; world += 1) {
      expect(CAMPAIGN_LEVELS.filter(level => level.world === world)).toHaveLength(6)
    }
    expect(CAMPAIGN_LEVELS[0].topic).toBe('numbers')
    expect(CAMPAIGN_LEVELS[6].topic).toBe('zhuyin')
    expect(CAMPAIGN_LEVELS[12].topic).toBe('characters')
    expect(CAMPAIGN_LEVELS[18].topic).toBe('mixed')
  })

  it('describes every individual challenge and includes all requested game modes', () => {
    expect(new Set(CAMPAIGN_LEVELS.map(level => level.title)).size).toBe(24)
    expect(CAMPAIGN_LEVELS.every(level => level.story.length > 25 && level.challenge.length > 15)).toBe(true)
    expect(new Set(CAMPAIGN_LEVELS.map(level => level.mode))).toEqual(new Set(['connect', 'memory', 'shoot', 'match3', 'relay']))
    expect(CAMPAIGN_LEVELS.map(level => level.title).join(' ')).toContain('消消樂')
    expect(CAMPAIGN_LEVELS.map(level => level.challenge).join(' ')).toContain('泡泡靶')
  })

  it('gives every round one distinct correct answer and enough matching cards', () => {
    for (const level of CAMPAIGN_LEVELS) {
      expect(level.pairs.length).toBeGreaterThanOrEqual(3)
      expect(level.pairs.every(pair => pair.key && pair.left && pair.right && pair.learningNote)).toBe(true)
      expect(level.rounds.length).toBeGreaterThanOrEqual(4)
      for (const round of level.rounds) {
        expect(round.picture.length).toBeGreaterThan(0)
        expect(round.choices.length).toBe(3)
        expect(new Set(round.choices).size).toBe(3)
        expect(round.choices).toContain(round.answer)
        expect(round.explanation.length).toBeGreaterThan(0)
      }
      expect(level.matchSymbols.length).toBeGreaterThanOrEqual(3)
      expect(level.matchTarget).toBeGreaterThan(0)
    }
  })

  it('fails clearly for an invalid campaign level id', () => {
    expect(() => getCampaignLevel(0)).toThrow('Unknown campaign level')
    expect(() => getCampaignLevel(25)).toThrow('Unknown campaign level')
  })
})

describe('campaign progress', () => {
  it('starts at level one and unlocks the next stop only after completing the prior stop', () => {
    expect(isLevelUnlocked(1, {})).toBe(true)
    expect(isLevelUnlocked(2, {})).toBe(false)
    expect(isLevelUnlocked(2, { 1: 1 })).toBe(true)
    expect(isLevelUnlocked(4, { 1: 3, 2: 2 })).toBe(false)
    expect(isLevelUnlocked(25, { 24: 3 })).toBe(false)
  })

  it('parses only valid saved stars and safely ignores malformed or corrupt storage', () => {
    expect(parseCampaignProgress('{bad')).toEqual({})
    expect(parseCampaignProgress('[]')).toEqual({})
    expect(parseCampaignProgress(JSON.stringify({ 1: 4, 2: 2, 3: 0, 25: 3, nope: 2 }))).toEqual({ 2: 2 })
  })

  it('preserves a level best and never takes stars away on a replay', () => {
    let progress = recordLevelStars({}, 1, 1)
    progress = recordLevelStars(progress, 1, 3)
    progress = recordLevelStars(progress, 1, 2)
    progress = recordLevelStars(progress, 2, 99)
    expect(progress).toEqual({ 1: 3, 2: 3 })
    expect(totalCampaignStars(progress)).toBe(6)
    expect(starsForMistakes(0)).toBe(3)
    expect(starsForMistakes(2)).toBe(2)
    expect(starsForMistakes(8)).toBe(1)
  })
})

describe('match-three rules', () => {
  it('detects horizontal and vertical groups without counting other tiles', () => {
    const horizontal = ['a', 'a', 'a', 'b', 'c', 'b', 'c', 'd', 'e', 'a', 'c', 'b', 'a', 'd', 'e', 'b', 'e', 'c', 'a', 'd', 'c', 'd', 'e', 'b', 'a']
    expect(findMatches(horizontal)).toEqual([0, 1, 2])

    const vertical = ['a', 'b', 'c', 'd', 'e', 'b', 'c', 'c', 'e', 'a', 'c', 'b', 'c', 'd', 'e', 'd', 'e', 'a', 'a', 'b', 'e', 'a', 'b', 'b', 'd']
    expect(findMatches(vertical)).toEqual([2, 7, 12])
  })

  it('accepts only adjacent swaps that create a three-symbol match', () => {
    const board = ['a', 'a', 'b', 'x', 'y', 'b', 'c', 'a', 'y', 'x', 'c', 'b', 'x', 'a', 'y', 'b', 'y', 'c', 'x', 'a', 'c', 'x', 'b', 'y', 'c']
    const good = tryMatchSwap(board, 2, 7)
    expect(good.valid).toBe(true)
    expect(good.matched).toEqual([0, 1, 2])
    expect(tryMatchSwap(board, 3, 4).valid).toBe(false)
    expect(tryMatchSwap(board, 0, 7).valid).toBe(false)
    expect(board[2]).toBe('b')
  })

  it('clears matched cells locally, drops survivors, and refills without replacing the whole board', () => {
    const board = [
      'x', 'y', 'x', 'b', 'c',
      'y', 'x', 'a', 'c', 'b',
      'x', 'b', 'a', 'y', 'c',
      'b', 'a', 'b', 'a', 'y',
      'c', 'x', 'y', 'c', 'x',
    ]
    const swap = tryMatchSwap(board, 16, 17)
    expect(swap.valid).toBe(true)
    expect(swap.matched).toEqual([7, 12, 17])

    const result = collapseAndRefillMatches(swap.board, swap.matched, ['x', 'y', 'a', 'b', 'c'], 5, () => 0.2)
    expect(result.board).toHaveLength(25)
    expect(result.refilledIndices).toEqual([2, 7, 12])
    expect(findMatches(result.board)).toEqual([])
    for (const col of [0, 1, 3, 4]) {
      for (let row = 0; row < 5; row += 1) expect(result.board[row * 5 + col]).toBe(swap.board[row * 5 + col])
    }
    expect(result.board[3 * 5 + 2]).toBe(swap.board[0 * 5 + 2])
    expect(result.board[4 * 5 + 2]).toBe(swap.board[4 * 5 + 2])
  })

  it('creates a match-free board with at least one possible move', () => {
    for (let seed = 0; seed < 8; seed += 1) {
      let value = seed + 1
      const random = () => {
        value = (value * 9301 + 49297) % 233280
        return value / 233280
      }
      const board = createMatchBoard(['1', '2', '3'], 5, random)
      expect(board).toHaveLength(25)
      expect(findMatches(board)).toEqual([])
      let hasMove = false
      for (let i = 0; i < board.length; i += 1) {
        if (i % 5 < 4 && tryMatchSwap(board, i, i + 1).valid) hasMove = true
        if (i < 20 && tryMatchSwap(board, i, i + 5).valid) hasMove = true
      }
      expect(hasMove).toBe(true)
    }
    expect(() => createMatchBoard(['x', 'y'])).toThrow('至少需要三種')
  })
})
