import { describe, expect, it } from 'vitest'
import { dilate, scoreTrace } from '../src/game/trace-rules'

const SIZE = 16
/** A vertical bar two cells wide down the middle of the grid. */
const bar = () => {
  const mask = new Uint8Array(SIZE * SIZE)
  for (let y = 2; y < 14; y += 1) for (const x of [7, 8]) mask[y * SIZE + x] = 1
  return mask
}

describe('tracing check', () => {
  it('dilates a single cell into its neighbourhood', () => {
    const mask = new Uint8Array(SIZE * SIZE)
    mask[5 * SIZE + 5] = 1
    expect(dilate(mask, SIZE, 1).reduce((total, cell) => total + cell, 0)).toBe(9)
  })

  it('passes ink that follows the track', () => {
    const score = scoreTrace(bar(), bar(), SIZE)
    expect(score.passed).toBe(true)
    expect(score.coverage).toBe(1)
  })

  it('asks for more when only part of the track is traced', () => {
    const ink = new Uint8Array(SIZE * SIZE)
    for (let y = 2; y < 5; y += 1) ink[y * SIZE + 7] = 1
    const score = scoreTrace(bar(), ink, SIZE)
    expect(score.passed).toBe(false)
    expect(score.coverage).toBeLessThan(0.6)
  })

  it('rejects scribbling over the whole canvas', () => {
    const score = scoreTrace(bar(), new Uint8Array(SIZE * SIZE).fill(1), SIZE)
    expect(score.coverage).toBe(1)
    expect(score.precision).toBeLessThan(0.7)
    expect(score.passed).toBe(false)
  })

  it('fails an empty canvas', () => {
    expect(scoreTrace(bar(), new Uint8Array(SIZE * SIZE), SIZE).passed).toBe(false)
  })
})
