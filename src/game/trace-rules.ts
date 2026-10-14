/**
 * Tracing check for the 描寫 levels. Both the target track (the fat outline of the symbol) and
 * the child's ink are rasterised onto the same small grid; the trace passes when the ink covers
 * enough of the track and most of the ink stays on it. Stroke order is not checked.
 */
export const TRACE_GRID = 64
// Kept generous for 5–6 year olds: wobbly lines that roughly follow the shape should pass.
export const TRACE_MIN_COVERAGE = 0.45
export const TRACE_MIN_PRECISION = 0.55

export type TraceScore = { coverage: number; precision: number; passed: boolean }

/** Marks every cell within `radius` cells of a filled cell. */
export function dilate(mask: ArrayLike<number>, size: number, radius: number): Uint8Array {
  const out = new Uint8Array(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!mask[y * size + x]) continue
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < size && ny < size) out[ny * size + nx] = 1
        }
      }
    }
  }
  return out
}

export function scoreTrace(target: ArrayLike<number>, ink: ArrayLike<number>, size = TRACE_GRID): TraceScore {
  const nearInk = dilate(ink, size, 2)
  const nearTarget = dilate(target, size, 4)
  let targetCells = 0
  let coveredCells = 0
  let inkCells = 0
  let onTargetCells = 0
  for (let index = 0; index < size * size; index += 1) {
    if (target[index]) {
      targetCells += 1
      if (nearInk[index]) coveredCells += 1
    }
    if (ink[index]) {
      inkCells += 1
      if (nearTarget[index]) onTargetCells += 1
    }
  }
  const coverage = targetCells ? coveredCells / targetCells : 0
  const precision = inkCells ? onTargetCells / inkCells : 0
  return { coverage, precision, passed: coverage >= TRACE_MIN_COVERAGE && precision >= TRACE_MIN_PRECISION }
}
