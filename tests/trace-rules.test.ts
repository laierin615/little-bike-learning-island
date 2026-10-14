import { describe, expect, it } from 'vitest'
import { TRACE_GRID, TRACE_MIN_COVERAGE, TRACE_MIN_PRECISION, dilate, scoreTrace } from '../src/game/trace-rules'

const SIZE = TRACE_GRID
/** A vertical bar six cells wide down the middle of the grid, like a traced 1. */
const bar = () => {
  const mask = new Uint8Array(SIZE * SIZE)
  for (let y = 10; y < 54; y += 1) for (let x = 29; x < 35; x += 1) mask[y * SIZE + x] = 1
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

  it('accepts a wobbly line that roughly follows the track', () => {
    const ink = new Uint8Array(SIZE * SIZE)
    for (let y = 12; y < 52; y += 1) {
      const x = 32 + Math.round(Math.sin(y / 3) * 3)
      ink[y * SIZE + x] = 1
      ink[y * SIZE + x + 1] = 1
    }
    expect(scoreTrace(bar(), ink, SIZE).passed).toBe(true)
  })

  it('asks for more when only part of the track is traced', () => {
    const ink = new Uint8Array(SIZE * SIZE)
    for (let y = 10; y < 18; y += 1) ink[y * SIZE + 32] = 1
    const score = scoreTrace(bar(), ink, SIZE)
    expect(score.passed).toBe(false)
    expect(score.coverage).toBeLessThan(TRACE_MIN_COVERAGE)
  })

  it('rejects scribbling over the whole canvas', () => {
    const score = scoreTrace(bar(), new Uint8Array(SIZE * SIZE).fill(1), SIZE)
    expect(score.coverage).toBe(1)
    expect(score.precision).toBeLessThan(TRACE_MIN_PRECISION)
    expect(score.passed).toBe(false)
  })

  it('fails an empty canvas', () => {
    expect(scoreTrace(bar(), new Uint8Array(SIZE * SIZE), SIZE).passed).toBe(false)
  })
})
