import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_ACTION' | 'NEXT_RUN'
type Boundary = 'jump' | 'dash' | 'run'
type Control = {
  id: string
  type: 'number'
  category: string
  label: string
  description: string
  unit: string
  default: number
  min: number
  max: number
  step: number
  applyMode: Mode
  integrity: 'COSMETIC'
}
type Binding = { control: Control; read(): number; write(value: number): void }

const bindings: Binding[] = []
function cameraNumber(key: keyof typeof CONFIG.camera & string, label: string, min: number, max: number, step: number, unit: string): void {
  const values = CONFIG.camera as Record<string, number>
  const defaults = DEFAULT_CONFIG.camera as Record<string, number>
  bindings.push({
    control: Object.freeze({
      id: `camera.${key}`,
      type: 'number',
      category: 'Camera',
      label,
      description: 'Updates this preview immediately.',
      unit,
      default: defaults[key],
      min,
      max,
      step,
      applyMode: 'LIVE',
      integrity: 'COSMETIC',
    }),
    read: () => values[key],
    write: value => { values[key] = value },
  })
}

cameraNumber('fov', 'Field of view', 40, 100, 1, '°')
cameraNumber('distance', 'Viewing distance', 3, 12, 0.1, 'm')
cameraNumber('follow', 'Camera ease', 2, 20, 1, '')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))

export const tuning = {
  get unranked(): boolean { return false },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    requested = { ...requested, ...patch } as Record<string, number>
    for (const [id, value] of entries) byId.get(id)!.write(value as number)
  },
  activate(_boundary: Boundary): void {
    for (const binding of bindings) binding.write(requested[binding.control.id])
  },
}
