export type CampaignProgress = Partial<Record<number, number>>
export const CAMPAIGN_PROGRESS_KEY = 'shuziyin.campaign-progress.v1'
export const CAMPAIGN_LEVEL_COUNT = 30
export const MATCH_GRID_SIZE = 5

export function parseCampaignProgress(raw: string | null): CampaignProgress {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const value = parsed as Record<string, unknown>
    const output: CampaignProgress = {}
    for (let id = 1; id <= CAMPAIGN_LEVEL_COUNT; id += 1) {
      const stars = value[String(id)]
      if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= 3) output[id] = stars
    }
    return output
  } catch {
    return {}
  }
}

export function isLevelUnlocked(id: number, progress: CampaignProgress): boolean {
  return Number.isInteger(id) && id >= 1 && id <= CAMPAIGN_LEVEL_COUNT && (id === 1 || (progress[id - 1] ?? 0) > 0)
}

export function recordLevelStars(progress: CampaignProgress, id: number, stars: number): CampaignProgress {
  if (!Number.isInteger(id) || id < 1 || id > CAMPAIGN_LEVEL_COUNT) return { ...progress }
  const earned = Math.max(1, Math.min(3, Math.floor(Number.isFinite(stars) ? stars : 1)))
  return { ...progress, [id]: Math.max(progress[id] ?? 0, earned) }
}

export function totalCampaignStars(progress: CampaignProgress): number {
  return Object.values(progress).reduce<number>((total, stars) => total + (stars ?? 0), 0)
}

/** Encourages a careful first try but never removes a star or blocks the next level. */
export function starsForMistakes(mistakes: number): number {
  if (mistakes <= 1) return 3
  if (mistakes <= 3) return 2
  return 1
}

export function findMatches(board: readonly string[], size = MATCH_GRID_SIZE): number[] {
  if (size < 3 || board.length !== size * size) return []
  const matches = new Set<number>()

  for (let row = 0; row < size; row += 1) {
    let col = 0
    while (col < size) {
      const start = col
      const symbol = board[row * size + col]
      while (col + 1 < size && board[row * size + col + 1] === symbol) col += 1
      if (col - start + 1 >= 3) {
        for (let x = start; x <= col; x += 1) matches.add(row * size + x)
      }
      col += 1
    }
  }

  for (let col = 0; col < size; col += 1) {
    let row = 0
    while (row < size) {
      const start = row
      const symbol = board[row * size + col]
      while (row + 1 < size && board[(row + 1) * size + col] === symbol) row += 1
      if (row - start + 1 >= 3) {
        for (let y = start; y <= row; y += 1) matches.add(y * size + col)
      }
      row += 1
    }
  }
  return [...matches].sort((a, b) => a - b)
}

export function tryMatchSwap(board: readonly string[], from: number, to: number, size = MATCH_GRID_SIZE): { valid: boolean; board: string[]; matched: number[] } {
  if (board.length !== size * size || from < 0 || to < 0 || from >= board.length || to >= board.length) {
    return { valid: false, board: [...board], matched: [] }
  }
  const fromRow = Math.floor(from / size)
  const fromCol = from % size
  const toRow = Math.floor(to / size)
  const toCol = to % size
  if (Math.abs(fromRow - toRow) + Math.abs(fromCol - toCol) !== 1) {
    return { valid: false, board: [...board], matched: [] }
  }
  const next = [...board]
  ;[next[from], next[to]] = [next[to], next[from]]
  const matched = findMatches(next, size)
  return matched.length ? { valid: true, board: next, matched } : { valid: false, board: [...board], matched: [] }
}

/** Removes only matched tiles, lets survivors fall within their columns, then tops up without free matches. */
export function collapseAndRefillMatches(
  board: readonly string[],
  matched: readonly number[],
  symbols: readonly string[],
  size = MATCH_GRID_SIZE,
  random: () => number = Math.random,
): { board: string[]; refilledIndices: number[] } {
  if (size < 3 || board.length !== size * size || symbols.length < 3) {
    return { board: [...board], refilledIndices: [] }
  }

  let current = [...board]
  let pending = [...new Set(matched.filter(index => Number.isInteger(index) && index >= 0 && index < current.length))]
  const refilled = new Set<number>()

  for (let cascade = 0; pending.length && cascade < size * size; cascade += 1) {
    const removed = new Set(pending)
    const next = Array<string>(size * size).fill('')
    const fillPositions: number[] = []

    for (let col = 0; col < size; col += 1) {
      const survivors: string[] = []
      for (let row = size - 1; row >= 0; row -= 1) {
        const index = row * size + col
        if (!removed.has(index)) survivors.push(current[index])
      }
      const fillCount = size - survivors.length
      for (let offset = 0; offset < survivors.length; offset += 1) {
        const row = size - 1 - offset
        next[row * size + col] = survivors[offset]
      }
      for (let row = 0; row < fillCount; row += 1) fillPositions.push(row * size + col)
    }

    const wouldCreateMatch = (index: number, symbol: string): boolean => {
      const row = Math.floor(index / size)
      const col = index % size
      for (let start = Math.max(0, col - 2); start <= Math.min(col, size - 3); start += 1) {
        if ([start, start + 1, start + 2].every(x => x === col || next[row * size + x] === symbol)) return true
      }
      for (let start = Math.max(0, row - 2); start <= Math.min(row, size - 3); start += 1) {
        if ([start, start + 1, start + 2].every(y => y === row || next[y * size + col] === symbol)) return true
      }
      return false
    }

    let searchSteps = 0
    const fill = (position: number): boolean => {
      if (position >= fillPositions.length) return true
      if (searchSteps++ > 20000) return false
      const index = fillPositions[position]
      const start = Math.floor(Math.max(0, Math.min(0.999999, random())) * symbols.length)
      for (let offset = 0; offset < symbols.length; offset += 1) {
        const symbol = symbols[(start + offset) % symbols.length]
        if (wouldCreateMatch(index, symbol)) continue
        next[index] = symbol
        if (fill(position + 1)) return true
        next[index] = ''
      }
      return false
    }

    if (!fill(0)) {
      const fallback = createMatchBoard(symbols, size, random)
      return { board: fallback, refilledIndices: fallback.map((_symbol, index) => index) }
    }
    fillPositions.forEach(index => refilled.add(index))
    current = next
    pending = findMatches(current, size)
  }

  return { board: current, refilledIndices: [...refilled].sort((a, b) => a - b) }
}

function hasPossibleSwap(board: readonly string[], size: number): boolean {
  for (let index = 0; index < board.length; index += 1) {
    const col = index % size
    if (col + 1 < size && tryMatchSwap(board, index, index + 1, size).valid) return true
    if (index + size < board.length && tryMatchSwap(board, index, index + size, size).valid) return true
  }
  return false
}

export function createMatchBoard(symbols: readonly string[], size = MATCH_GRID_SIZE, random: () => number = Math.random): string[] {
  if (symbols.length < 3) throw new Error('消消樂棋盤至少需要三種圖塊。')
  if (size < 3) throw new Error('消消樂棋盤至少需要三列。')

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const board: string[] = []
    for (let index = 0; index < size * size; index += 1) {
      const row = Math.floor(index / size)
      const col = index % size
      const safe = symbols.filter(symbol => {
        const horizontalTriple = col >= 2 && board[index - 1] === symbol && board[index - 2] === symbol
        const verticalTriple = row >= 2 && board[index - size] === symbol && board[index - size * 2] === symbol
        return !horizontalTriple && !verticalTriple
      })
      const choices = safe.length ? safe : [...symbols]
      const randomValue = Math.max(0, Math.min(0.999999, random()))
      board.push(choices[Math.floor(randomValue * choices.length)])
    }
    if (!findMatches(board, size).length && hasPossibleSwap(board, size)) return board
  }

  // Guaranteed playable, match-free 5×5 fallback: swapping B and A in the upper-left creates AAA.
  if (size === 5) {
    const [a, b, c] = symbols
    return [a, a, b, a, b, b, c, a, c, b, c, a, b, b, c, b, c, a, b, a, c, b, c, a, b]
  }
  return symbols.flatMap((_, index) => Array.from({ length: size * size }, (_unused, cell) => symbols[(cell + index) % symbols.length])).slice(0, size * size)
}
