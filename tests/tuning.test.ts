import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
afterEach(() => tuning.apply(defaults))

describe('Three.js learning-island tuning', () => {
  it('keeps only camera controls that the new scene actually consumes', () => {
    expect(tuning.controls.map(control => control.id).sort()).toEqual([
      'camera.distance', 'camera.follow', 'camera.fov',
    ])
    expect(tuning.controls.every(control => control.integrity === 'COSMETIC' && control.applyMode === 'LIVE')).toBe(true)
  })

  it('validates a complete patch before committing any value', () => {
    const before = tuning.read()
    for (const patch of [
      { 'camera.fov': 90, 'camera.distance': 13 },
      { 'camera.fov': 90, 'camera.distance': 9.05 },
      { 'camera.follow': '8' },
      { 'camera.fov': Infinity },
      { unknown: 4 },
    ]) {
      expect(() => tuning.apply(patch)).toThrow()
      expect(tuning.read()).toEqual(before)
    }
  })

  it('applies and resets actual camera settings without editing source defaults', () => {
    tuning.apply({ 'camera.fov': 90, 'camera.distance': 9, 'camera.follow': 12 })
    expect(CONFIG.camera.fov).toBe(90)
    expect(CONFIG.camera.distance).toBe(9)
    expect(CONFIG.camera.follow).toBe(12)
    expect(DEFAULT_CONFIG.camera.fov).not.toBe(90)
    expect(tuning.unranked).toBe(false)
    tuning.apply(defaults)
    expect(tuning.read().active).toEqual(defaults)
  })

  it('keeps the manager boundary API compatible with the existing preview bridge', () => {
    tuning.apply({ 'camera.fov': 80 })
    tuning.activate('jump')
    expect(CONFIG.camera.fov).toBe(80)
    tuning.activate('dash')
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
  })
})
