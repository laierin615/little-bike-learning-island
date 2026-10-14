import * as THREE from 'three'
import riderImage from '../../assets/images/bike-rider.png'
import type { Renderer } from '../engine/renderer'
import { CONFIG } from './config'
import type { ActivityId } from './lessons'

const ACTIVITY_COLORS: Record<ActivityId, number> = {
  numbers: 0xf0457d,
  zhuyin: 0x18b38f,
  characters: 0xf47b20,
}

/** Sky gradients (top → horizon) for the candy town; null is the hub sky. */
const DEFAULT_SKY: [string, string] = ['#5fbfff', '#ffd3ec']
const ACTIVITY_SKIES: Record<ActivityId, [string, string]> = {
  numbers: ['#ff8ab8', '#ffe4f0'],
  zhuyin: ['#62d9c0', '#e4fff5'],
  characters: ['#ffab5e', '#fff1d8'],
}

const LEARNING_SIGNS: Record<ActivityId, string> = {
  numbers: '1　2　3',
  zhuyin: 'ㄅ　ㄇ　ㄍ',
  characters: '日　山　水',
}

/** Candy palette shared by houses, sprinkles, flags and balloons. */
const CANDY = ['#ff4f8b', '#ff9a2e', '#ffd23f', '#3fd18b', '#3fb5ff', '#a35cff', '#ff6fd8']

type Floater = { object: THREE.Object3D; y: number; phase: number; amplitude: number; speed: number }

/** A cheerful, animated candy-town island hub behind the short learning activities. */
export class LearningScene {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 120)
  private readonly floaters: Floater[] = []
  private readonly portals = new Map<ActivityId, THREE.Mesh>()
  private readonly learningSigns = new Map<ActivityId, THREE.Sprite>()
  private readonly skyTextures = new Map<string, THREE.Texture>()
  private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>()
  private swirlTexture: THREE.Texture | null = null
  private time = 0
  private activity: ActivityId | null = null
  private reducedMotion = false
  private cameraTarget = new THREE.Vector3(0, 0, 0)
  private readonly cameraLook = new THREE.Vector3(0, 0.4, 0)
  private readonly riderPath = [
    new THREE.Vector3(0, 2.9, 4.05), new THREE.Vector3(2.85, 2.9, 2.85),
    new THREE.Vector3(4.05, 2.9, 0), new THREE.Vector3(2.85, 2.9, -2.85),
    new THREE.Vector3(0, 2.9, -4.05), new THREE.Vector3(-2.85, 2.9, -2.85),
    new THREE.Vector3(-4.05, 2.9, 0), new THREE.Vector3(-2.85, 2.9, 2.85),
  ]
  private readonly riderTarget = this.riderPath[0].clone()
  private rider: THREE.Sprite | null = null
  private riderSteps = 0

  constructor(private readonly renderer: Renderer) {
    this.applySky(DEFAULT_SKY)
    this.scene.add(new THREE.HemisphereLight('#fff6fb', '#f2a9c8', 2.0))

    const sun = new THREE.DirectionalLight('#fff0d2', 2.7)
    sun.position.set(-7, 12, 8)
    this.scene.add(sun)
    const fill = new THREE.DirectionalLight('#c9b8ff', 0.9)
    fill.position.set(8, 5, -7)
    this.scene.add(fill)

    this.buildIsland()
    this.buildCyclingRoad()
    this.buildTown()
    this.buildDistantTown()
    this.buildClouds()
    this.buildBalloons()
    this.camera.position.set(0, 9.5, 17)
    this.camera.lookAt(this.cameraLook)
  }

  async loadRider(): Promise<void> {
    const texture = await new THREE.TextureLoader().loadAsync(riderImage)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.015, depthWrite: false })
    this.rider = new THREE.Sprite(material)
    this.rider.scale.set(2.9, 4, 1)
    this.rider.position.copy(this.riderTarget)
    this.rider.renderOrder = 2
    this.scene.add(this.rider)
    await document.fonts.ready
    this.buildLearningSigns()
  }

  get rideSteps(): number {
    return this.riderSteps
  }

  get riderLoaded(): boolean {
    return this.rider !== null
  }

  get learningSignCount(): number {
    return this.learningSigns.size
  }

  advanceRider(): void {
    if (!this.rider) return
    this.riderSteps += 1
    this.riderTarget.copy(this.riderPath[this.riderSteps % this.riderPath.length])
  }

  setActivity(activity: ActivityId | null): void {
    this.activity = activity
    this.applySky(activity ? ACTIVITY_SKIES[activity] : DEFAULT_SKY)
    if (activity) {
      const positions: Record<ActivityId, THREE.Vector3> = {
        numbers: new THREE.Vector3(-3.3, 0.6, -1.9),
        zhuyin: new THREE.Vector3(0, 0.6, -3.8),
        characters: new THREE.Vector3(3.3, 0.6, -1.9),
      }
      this.cameraTarget.copy(positions[activity])
    } else {
      this.cameraTarget.set(0, 0, 0)
    }
    this.riderSteps = 0
    this.riderTarget.copy(this.riderPath[0])
    this.rider?.position.copy(this.riderTarget)
    for (const [id, portal] of this.portals) {
      const material = portal.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = activity === id ? 0.75 : activity ? 0.06 : 0.18
      portal.scale.setScalar(activity === id ? 1.22 : 1)
    }
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
  }

  step(dt: number): void {
    this.time += dt
    const motionScale = this.reducedMotion ? 0.14 : 1
    for (const item of this.floaters) {
      item.object.position.y = item.y + Math.sin(this.time * item.speed * motionScale + item.phase) * item.amplitude * motionScale
      if (item.object.userData.spin) item.object.rotation.y += dt * 0.35 * motionScale
    }
    for (const portal of this.portals.values()) {
      portal.rotation.z += dt * (this.reducedMotion ? 0.04 : 0.24)
    }
    if (this.rider) {
      const follow = 1 - Math.exp(-dt * (this.reducedMotion ? 2 : 4.5))
      this.rider.position.x += (this.riderTarget.x - this.rider.position.x) * follow
      this.rider.position.z += (this.riderTarget.z - this.rider.position.z) * follow
      this.rider.position.y = this.riderTarget.y + Math.sin(this.time * 5.5) * 0.035 * motionScale
      ;(this.rider.material as THREE.SpriteMaterial).rotation = Math.sin(this.time * 3.5) * 0.012 * motionScale
    }
  }

  render(_alpha: number, frameSeconds: number): void {
    const fov = CONFIG.camera.fov
    if (this.camera.fov !== fov) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    const follow = Math.min(1, frameSeconds * CONFIG.camera.follow * 0.12)
    const lookAt = this.cameraLook.clone().lerp(this.cameraTarget, this.activity ? 0.34 : 0.12)
    this.cameraLook.lerp(lookAt, follow)
    const radius = Math.max(12, CONFIG.camera.distance * 2.1)
    const orbit = this.reducedMotion ? Math.sin(this.time * 0.02) * 0.02 : Math.sin(this.time * 0.035) * 0.16
    const cameraTargetPos = new THREE.Vector3(Math.sin(orbit) * 1.6, 8.8, radius)
    this.camera.position.lerp(cameraTargetPos, follow)
    this.camera.lookAt(this.cameraLook)
    this.renderer.render(this.scene, this.camera)
  }

  private applySky([top, horizon]: [string, string]): void {
    const key = `${top}|${horizon}`
    let texture = this.skyTextures.get(key)
    if (!texture) {
      const canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 256
      const context = canvas.getContext('2d')
      if (context) {
        const gradient = context.createLinearGradient(0, 0, 0, 256)
        gradient.addColorStop(0, top)
        gradient.addColorStop(0.62, horizon)
        gradient.addColorStop(1, horizon)
        context.fillStyle = gradient
        context.fillRect(0, 0, 4, 256)
      }
      texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      this.skyTextures.set(key, texture)
    }
    this.scene.background = texture
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(horizon)
    else this.scene.fog = new THREE.Fog(horizon, 24, 62)
  }

  /** Glossy, candy-like material, cached per colour. */
  private candy(color: string, roughness = 0.3): THREE.MeshPhysicalMaterial {
    const key = `${color}|${roughness}`
    let material = this.materials.get(key)
    if (!material) {
      material = new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 0.7, clearcoatRoughness: 0.25 })
      this.materials.set(key, material)
    }
    return material
  }

  /** Red-and-white lollipop swirl, drawn once on a canvas. */
  private swirl(): THREE.Texture {
    if (this.swirlTexture) return this.swirlTexture
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (context) {
      const colors = ['#ff3f7f', '#fff7fb', '#ffb43a', '#fff7fb']
      for (let r = 128; r > 0; r -= 2) {
        for (let i = 0; i < 8; i += 1) {
          const start = (i / 8) * Math.PI * 2 + r * 0.045
          context.beginPath()
          context.moveTo(128, 128)
          context.arc(128, 128, r, start, start + Math.PI / 4)
          context.closePath()
          context.fillStyle = colors[i % colors.length]
          context.fill()
        }
      }
    }
    this.swirlTexture = new THREE.CanvasTexture(canvas)
    this.swirlTexture.colorSpace = THREE.SRGBColorSpace
    return this.swirlTexture
  }

  private buildLearningSigns(): void {
    const positions: Record<ActivityId, [number, number, number]> = {
      numbers: [-3.3, 4.05, -1.95],
      zhuyin: [0, 4.65, -3.72],
      characters: [3.3, 4.05, -1.95],
    }
    for (const id of Object.keys(LEARNING_SIGNS) as ActivityId[]) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 192
      const context = canvas.getContext('2d')
      if (!context) continue

      const color = `#${ACTIVITY_COLORS[id].toString(16).padStart(6, '0')}`
      context.fillStyle = color
      context.beginPath()
      context.roundRect(8, 18, 496, 166, 46)
      context.fill()
      context.lineWidth = 10
      context.strokeStyle = '#ffffff'
      context.fillStyle = '#fffdf8'
      context.beginPath()
      context.roundRect(10, 8, 492, 160, 44)
      context.fill()
      context.stroke()
      context.lineWidth = 6
      context.strokeStyle = color
      context.stroke()
      context.font = '900 78px "ManusCC0 Sans CJK SC", "Noto Sans CJK TC", sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = color
      context.fillText(LEARNING_SIGNS[id], 256, 92)

      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
      const [x, y, z] = positions[id]
      sign.scale.set(2.55, 0.96, 1)
      sign.position.set(x, y, z)
      sign.renderOrder = 1
      sign.userData.learningSign = id
      this.learningSigns.set(id, sign)
      this.scene.add(sign)
      this.float(sign, y, 0.055, 0.82)
    }
  }

  /** Layer-cake island: chocolate base, sponge band, pink frosting drips and a mint-candy lawn. */
  private buildIsland(): void {
    const island = new THREE.Group()
    this.scene.add(island)

    const chocolate = new THREE.Mesh(new THREE.CylinderGeometry(7.0, 7.3, 1.1, 40), this.candy('#7b3f2a', 0.55))
    chocolate.position.y = -0.55
    island.add(chocolate)

    const sponge = new THREE.Mesh(new THREE.CylinderGeometry(7.05, 7.05, 0.36, 40), this.candy('#ffd38a', 0.6))
    sponge.position.y = 0.17
    island.add(sponge)

    const frosting = new THREE.Mesh(new THREE.CylinderGeometry(7.15, 7.1, 0.3, 40), this.candy('#ff6fae'))
    frosting.position.y = 0.48
    island.add(frosting)
    const dripMaterial = this.candy('#ff6fae')
    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * Math.PI * 2
      const length = 0.35 + ((i * 7) % 5) * 0.09
      const drip = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, length, 4, 8), dripMaterial)
      drip.position.set(Math.cos(angle) * 7.08, 0.42 - length / 2, Math.sin(angle) * 7.08)
      island.add(drip)
    }

    const lawn = new THREE.Mesh(new THREE.CylinderGeometry(6.95, 6.95, 0.12, 40), this.candy('#5fd98a', 0.5))
    lawn.position.y = 0.66
    island.add(lawn)

    // Waffle-cone underside instead of rock.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(5.2, 5.6, 14), this.candy('#e9a24e', 0.7))
    cone.rotation.x = Math.PI
    cone.position.y = -3.9
    island.add(cone)
    const sprinkleRing = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.32, 10, 48), this.candy('#fff3c4', 0.5))
    sprinkleRing.rotation.x = Math.PI / 2
    sprinkleRing.position.y = -1.15
    island.add(sprinkleRing)

    const locations: Record<ActivityId, [number, number, number]> = {
      numbers: [-3.3, 0.82, -2],
      zhuyin: [0, 0.82, -3.8],
      characters: [3.3, 0.82, -2],
    }
    for (const id of Object.keys(locations) as ActivityId[]) {
      const [x, y, z] = locations[id]
      const color = ACTIVITY_COLORS[id]
      const hex = `#${color.toString(16).padStart(6, '0')}`
      // Macaron pad.
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.62, 0.26, 32), this.candy(hex, 0.45))
      lower.position.set(x, y - 0.06, z)
      island.add(lower)
      const cream = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.12, 32), this.candy('#fff8ef', 0.5))
      cream.position.set(x, y + 0.13, z)
      island.add(cream)

      // Frosted donut portal.
      const rimMaterial = new THREE.MeshPhysicalMaterial({ color: hex, emissive: color, emissiveIntensity: 0.18, roughness: 0.3, clearcoat: 0.8 })
      const portal = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.22, 16, 40), rimMaterial)
      portal.position.set(x, y + 1.4, z - 0.04)
      for (let i = 0; i < 14; i += 1) {
        const angle = (i / 14) * Math.PI * 2
        const sprinkle = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.1, 2, 6), this.candy(CANDY[i % CANDY.length]))
        sprinkle.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0.21)
        sprinkle.rotation.z = angle * 2.3
        portal.add(sprinkle)
      }
      this.portals.set(id, portal)
      island.add(portal)
      this.float(portal, portal.position.y, 0.11, id === 'zhuyin' ? 1.4 : 1.1)

      // Wrapped candy instead of a gem.
      const wrapped = new THREE.Group()
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), this.candy('#ffd23f', 0.25))
      body.scale.set(1.25, 1, 1)
      wrapped.add(body)
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 10), this.candy(hex, 0.3))
        wing.rotation.z = side * Math.PI / 2
        wing.position.x = side * 0.48
        wrapped.add(wing)
      }
      wrapped.position.set(x, y + 2.5, z)
      wrapped.userData.spin = true
      island.add(wrapped)
      this.float(wrapped, wrapped.position.y, 0.2, 1.5)
    }

    // Central cupcake fountain.
    const cupcake = new THREE.Group()
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 0.7, 16), this.candy('#3fb5ff', 0.45))
    liner.position.y = 0.35
    cupcake.add(liner)
    const icing = new THREE.Mesh(new THREE.SphereGeometry(0.82, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), this.candy('#fff0f7', 0.35))
    icing.position.y = 0.68
    cupcake.add(icing)
    const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), this.candy('#ff2d55', 0.2))
    cherry.position.y = 1.62
    cupcake.add(cherry)
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      const sprinkle = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.12, 2, 6), this.candy(CANDY[i % CANDY.length]))
      sprinkle.position.set(Math.cos(angle) * 0.52, 1.24, Math.sin(angle) * 0.52)
      sprinkle.rotation.set(angle, 0, angle * 1.7)
      cupcake.add(sprinkle)
    }
    cupcake.position.set(0, 0.72, 0.4)
    island.add(cupcake)
  }

  /** Pink candy track with white icing edges and a rainbow-sprinkle centre line. */
  private buildCyclingRoad(): void {
    const road = new THREE.Mesh(
      new THREE.RingGeometry(3.25, 4.72, 96),
      new THREE.MeshStandardMaterial({ color: '#ff8fc0', roughness: 0.6, side: THREE.DoubleSide }),
    )
    road.rotation.x = -Math.PI / 2
    road.position.y = 0.735
    this.scene.add(road)

    const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, side: THREE.DoubleSide })
    for (const [inner, outer] of [[3.18, 3.3], [4.66, 4.78]] as const) {
      const edge = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), edgeMaterial)
      edge.rotation.x = -Math.PI / 2
      edge.position.y = 0.75
      this.scene.add(edge)
    }

    for (let i = 0; i < 56; i += 1) {
      const angle = (i / 56) * Math.PI * 2
      const sprinkle = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 2, 6), this.candy(CANDY[i % CANDY.length]))
      sprinkle.position.set(Math.cos(angle) * 3.99, 0.78, Math.sin(angle) * 3.99)
      sprinkle.rotation.set(Math.PI / 2, 0, -angle)
      this.scene.add(sprinkle)
    }

    const entry = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.065, 3.1), this.candy('#ffe08a', 0.55))
    entry.position.set(0, 0.755, 2.45)
    this.scene.add(entry)
  }

  /** Ring of candy houses, lollipop trees, gumdrop bushes and bunting around the track. */
  private buildTown(): void {
    const houses: [number, number, number, string, string][] = [
      // angle (deg), radius, scale, wall, roof
      [-168, 5.85, 0.95, '#fff0b8', '#ff4f8b'],
      [-142, 5.95, 1.1, '#ffd6e8', '#a35cff'],
      [-115, 5.9, 0.9, '#d6f6ff', '#ff9a2e'],
      [-65, 5.9, 0.9, '#e7dcff', '#3fd18b'],
      [-38, 5.95, 1.1, '#ffe2c6', '#3fb5ff'],
      [-12, 5.85, 0.95, '#d8ffe6', '#ff4f8b'],
      [168, 5.95, 0.8, '#ffe0f0', '#ffb31f'],
      [12, 5.95, 0.8, '#fff3c9', '#a35cff'],
    ]
    houses.forEach(([deg, radius, scale, wall, roof]) => {
      const angle = THREE.MathUtils.degToRad(deg)
      this.addHouse(Math.cos(angle) * radius, Math.sin(angle) * radius, -angle - Math.PI / 2, scale, wall, roof)
    })

    // Lollipop trees between houses and at the front corners.
    for (const [deg, radius, height] of [[-155, 6.2, 1.5], [-90, 6.1, 1.8], [-25, 6.2, 1.5], [150, 6.1, 1.3], [30, 6.1, 1.3], [118, 5.6, 1.1], [62, 5.6, 1.1]] as const) {
      const angle = THREE.MathUtils.degToRad(deg)
      this.addLollipop(Math.cos(angle) * radius, Math.sin(angle) * radius, height)
    }

    // Gumdrop bushes.
    let colorIndex = 0
    for (const [deg, radius] of [[-128, 5.1], [-52, 5.1], [100, 5.3], [80, 5.3], [140, 5.4], [40, 5.4], [-178, 5.2], [-2, 5.2]] as const) {
      const angle = THREE.MathUtils.degToRad(deg)
      const gumdrop = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.candy(CANDY[colorIndex++ % CANDY.length], 0.2))
      gumdrop.scale.y = 1.25
      gumdrop.position.set(Math.cos(angle) * radius, 0.72, Math.sin(angle) * radius)
      this.scene.add(gumdrop)
    }

    // Candy-cane poles with party bunting across the back of the track.
    const poles: [number, number][] = [[-5.6, -1.2], [-3.2, -5.0], [3.2, -5.0], [5.6, -1.2]]
    for (const [x, z] of poles) this.addCandyCane(x, z)
    for (let i = 0; i < poles.length - 1; i += 1) {
      this.addBunting(new THREE.Vector3(poles[i][0], 2.55, poles[i][1]), new THREE.Vector3(poles[i + 1][0], 2.55, poles[i + 1][1]))
    }
  }

  /** Small floating cake islands with houses far behind the hub, for a busy-town skyline. */
  private buildDistantTown(): void {
    const spots: [number, number, number, number][] = [[-15, -1.5, -15, 1], [0, 0.5, -22, 1.25], [15, -1, -14, 1], [-22, 1.5, -4, 0.8], [22, 1, -3, 0.8]]
    spots.forEach(([x, y, z, scale], index) => {
      const group = new THREE.Group()
      const cake = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.8, 24), this.candy(index % 2 ? '#7b3f2a' : '#ffd38a', 0.55))
      group.add(cake)
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.22, 24), this.candy(index % 2 ? '#ffb0d2' : '#8be8a6'))
      top.position.y = 0.5
      group.add(top)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.0, 2.6, 10), this.candy('#e9a24e', 0.7))
      cone.rotation.x = Math.PI
      cone.position.y = -1.7
      group.add(cone)
      group.position.set(x, y, z)
      group.scale.setScalar(scale)
      this.scene.add(group)
      for (let i = 0; i < 3; i += 1) {
        this.addHouse(x + (i - 1) * 1.55 * scale, z + (i === 1 ? -0.4 : 0.3) * scale, 0, (i === 1 ? 1.25 : 0.95) * scale, ['#fff0b8', '#ffd6e8', '#d6f6ff'][(i + index) % 3], CANDY[(i * 2 + index) % CANDY.length], y + 0.6 * scale)
      }
      this.float(group, y, 0.12, 0.25 + index * 0.04)
    })
  }

  private buildClouds(): void {
    const tints = ['#ffffff', '#ffe1f0', '#efe1ff', '#fff3df']
    const cloudPositions: [number, number, number, number][] = [
      [-10, 6.4, -2, 1.6], [9, 5.3, -5, 1.3], [-8, 4.5, 7, 1.1], [9, 7, 5, 1.7], [-3, 9, -12, 2.1], [12, 9.5, -16, 1.8],
    ]
    cloudPositions.forEach(([x, y, z, scale], index) => {
      const cloudMaterial = new THREE.MeshStandardMaterial({ color: tints[index % tints.length], roughness: 0.9 })
      const cloud = new THREE.Group()
      for (const [dx, dy, dz, size] of [[0, 0, 0, 0.75], [0.62, 0.08, 0.05, 0.58], [-0.55, 0.05, 0.02, 0.5], [0.12, 0.34, 0, 0.51]] as const) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(size, 14, 10), cloudMaterial)
        puff.position.set(dx, dy, dz)
        cloud.add(puff)
      }
      cloud.scale.setScalar(scale)
      cloud.position.set(x, y, z)
      this.scene.add(cloud)
      this.float(cloud, y, 0.2, 0.14)
    })
  }

  private buildBalloons(): void {
    const spots: [number, number, number][] = [[-6.6, 5.2, -4.5], [-5.8, 6.0, -5.6], [6.4, 5.6, -4.2], [7.2, 4.8, -2.8], [0.8, 7.2, -7.5]]
    spots.forEach(([x, y, z], index) => {
      const balloon = new THREE.Group()
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), this.candy(CANDY[(index * 3) % CANDY.length], 0.18))
      ball.scale.y = 1.18
      balloon.add(ball)
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 8), ball.material)
      knot.position.y = -0.52
      balloon.add(knot)
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
      string.position.y = -1.35
      balloon.add(string)
      balloon.position.set(x, y, z)
      this.scene.add(balloon)
      this.float(balloon, y, 0.28, 0.5 + index * 0.08)
    })
  }

  private addHouse(x: number, z: number, rotation: number, scale: number, wall: string, roof: string, ground = 0.72): void {
    const house = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.05, 1.0), this.candy(wall, 0.5))
    body.position.y = 0.525
    house.add(body)
    // Frosting trim between wall and roof.
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.14, 1.12), this.candy('#ffffff', 0.4))
    trim.position.y = 1.1
    house.add(trim)
    const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(0.98, 0.95, 4), this.candy(roof, 0.25))
    roofMesh.position.y = 1.62
    roofMesh.rotation.y = Math.PI / 4
    house.add(roofMesh)
    const gumball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), this.candy('#ffd23f', 0.2))
    gumball.position.y = 2.15
    house.add(gumball)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.04), this.candy('#8a4b2f', 0.5))
    door.position.set(0, 0.26, 0.52)
    house.add(door)
    const windowMaterial = this.candy('#7fd8ff', 0.15)
    for (const side of [-1, 1]) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.04), windowMaterial)
      pane.position.set(side * 0.36, 0.68, 0.52)
      house.add(pane)
    }
    house.position.set(x, ground, z)
    house.rotation.y = rotation
    house.scale.setScalar(scale)
    this.scene.add(house)
  }

  private addLollipop(x: number, z: number, height: number): void {
    const lollipop = new THREE.Group()
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, height, 8), this.candy('#ffffff', 0.4))
    stick.position.y = height / 2
    lollipop.add(stick)
    const capMaterial = new THREE.MeshPhysicalMaterial({ map: this.swirl(), roughness: 0.25, clearcoat: 0.9 })
    const candy = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 32), [this.candy('#ff3f7f'), capMaterial, capMaterial])
    candy.rotation.x = Math.PI / 2
    candy.position.y = height + 0.45
    lollipop.add(candy)
    lollipop.position.set(x, 0.72, z)
    lollipop.lookAt(0, 0.72, 14)
    this.scene.add(lollipop)
    this.float(lollipop, 0.72, 0.03, 0.5)
  }

  private addCandyCane(x: number, z: number): void {
    const cane = new THREE.Group()
    for (let i = 0; i < 6; i += 1) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 10), this.candy(i % 2 ? '#ffffff' : '#ff2d55', 0.3))
      band.position.y = 0.16 + i * 0.32
      cane.add(band)
    }
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 8, 16, Math.PI), this.candy('#ff2d55', 0.3))
    hook.position.set(0.2, 1.92, 0)
    cane.add(hook)
    cane.position.set(x, 0.72, z)
    this.scene.add(cane)
  }

  private addBunting(from: THREE.Vector3, to: THREE.Vector3): void {
    const flags = 7
    const shape = new THREE.Shape()
    shape.moveTo(-0.16, 0)
    shape.lineTo(0.16, 0)
    shape.lineTo(0, -0.34)
    shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape)
    const span = to.clone().sub(from)
    const facing = Math.atan2(span.x, span.z) - Math.PI / 2
    for (let i = 0; i < flags; i += 1) {
      const t = (i + 0.5) / flags
      const flag = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: CANDY[i % CANDY.length], roughness: 0.5, side: THREE.DoubleSide }))
      flag.position.copy(from).lerp(to, t)
      flag.position.y -= Math.sin(t * Math.PI) * 0.35
      flag.rotation.y = facing
      this.scene.add(flag)
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, -0.7, 0)), to), 16, 0.015, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    this.scene.add(rope)
  }

  private float(object: THREE.Object3D, y: number, amplitude: number, speed: number): void {
    this.floaters.push({ object, y, phase: this.floaters.length * 1.7, amplitude, speed })
  }
}
