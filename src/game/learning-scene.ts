import * as THREE from 'three'
import riderImage from '../../assets/images/bike-rider.png'
import type { Renderer } from '../engine/renderer'
import { CONFIG } from './config'
import type { ActivityId } from './lessons'

const ACTIVITY_COLORS: Record<ActivityId, number> = {
  numbers: 0x58b782,
  zhuyin: 0x4d9bc8,
  characters: 0xd49451,
}

const ACTIVITY_SKIES: Record<ActivityId, string> = {
  numbers: '#d9f2ce',
  zhuyin: '#d2eef8',
  characters: '#f8e6cf',
}

const LEARNING_SIGNS: Record<ActivityId, string> = {
  numbers: '1　2　3',
  zhuyin: 'ㄅ　ㄇ　ㄍ',
  characters: '日　山　水',
}

type Floater = { object: THREE.Object3D; y: number; phase: number; amplitude: number; speed: number }

/** A quiet, animated 3D island hub behind the short learning activities. */
export class LearningScene {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 120)
  private readonly floaters: Floater[] = []
  private readonly portals = new Map<ActivityId, THREE.Mesh>()
  private readonly learningSigns = new Map<ActivityId, THREE.Sprite>()
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
    this.scene.background = new THREE.Color('#c7eaff')
    this.scene.fog = new THREE.Fog('#c7eaff', 22, 58)
    this.scene.add(new THREE.HemisphereLight('#f4fbff', '#809a6b', 2.25))

    const sun = new THREE.DirectionalLight('#fff3d6', 3.1)
    sun.position.set(-7, 12, 8)
    this.scene.add(sun)
    const fill = new THREE.DirectionalLight('#b4ddff', 1.1)
    fill.position.set(8, 5, -7)
    this.scene.add(fill)

    this.buildIsland()
    this.buildCyclingRoad()
    this.buildClouds()
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
    const sky = activity ? ACTIVITY_SKIES[activity] : '#c7eaff'
    this.scene.background = new THREE.Color(sky)
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(sky)
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
      material.emissiveIntensity = activity === id ? 0.9 : activity ? 0.08 : 0.22
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

      context.lineWidth = 8
      context.strokeStyle = `#${ACTIVITY_COLORS[id].toString(16).padStart(6, '0')}`
      context.fillStyle = 'rgba(255, 255, 250, 0.96)'
      context.beginPath()
      context.roundRect(8, 8, 496, 176, 42)
      context.fill()
      context.stroke()
      context.font = '900 78px "ManusCC0 Sans CJK SC", "Noto Sans CJK TC", sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = '#26384d'
      context.fillText(LEARNING_SIGNS[id], 256, 98)

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

  private buildIsland(): void {
    const island = new THREE.Group()
    this.scene.add(island)

    const rock = new THREE.Mesh(
      new THREE.CylinderGeometry(6.15, 7.15, 1.6, 12, 2),
      new THREE.MeshStandardMaterial({ color: '#927658', roughness: 1 }),
    )
    rock.position.y = -0.35
    rock.receiveShadow = true
    island.add(rock)

    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(6.2, 6.25, 0.32, 12, 1),
      new THREE.MeshStandardMaterial({ color: '#80c978', roughness: 0.92 }),
    )
    grass.position.y = 0.55
    grass.receiveShadow = true
    island.add(grass)

    const underside = new THREE.Mesh(
      new THREE.ConeGeometry(4.6, 3.5, 10),
      new THREE.MeshStandardMaterial({ color: '#8d7658', roughness: 1 }),
    )
    underside.position.y = -2.6
    island.add(underside)

    const locations: Record<ActivityId, [number, number, number]> = {
      numbers: [-3.3, 0.82, -2],
      zhuyin: [0, 0.82, -3.8],
      characters: [3.3, 0.82, -2],
    }
    for (const id of Object.keys(locations) as ActivityId[]) {
      const [x, y, z] = locations[id]
      const color = ACTIVITY_COLORS[id]
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.58, 1.7, 0.42, 32),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.04 }),
      )
      pad.position.set(x, y, z)
      island.add(pad)

      const rimMaterial = new THREE.MeshStandardMaterial({ color: '#fff5d8', emissive: color, emissiveIntensity: 0.22, roughness: 0.38 })
      const portal = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.1, 10, 40), rimMaterial)
      portal.position.set(x, y + 1.4, z - 0.04)
      this.portals.set(id, portal)
      island.add(portal)
      this.float(portal, portal.position.y, 0.11, id === 'zhuyin' ? 1.4 : 1.1)

      const gem = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.36, 0),
        new THREE.MeshStandardMaterial({ color: '#fff1a8', emissive: '#ffe06b', emissiveIntensity: 0.48, roughness: 0.35 }),
      )
      gem.position.set(x, y + 2.45, z)
      gem.userData.spin = true
      island.add(gem)
      this.float(gem, gem.position.y, 0.2, 1.5)
    }

    this.addTree(-4.75, 0.7, -3.2, 1.12, '#5cae72')
    this.addTree(-5.0, 0.7, 1.8, 0.86, '#70bd75')
    this.addTree(5.0, 0.7, 2.8, 1.02, '#62ae77')
    this.addTree(4.55, 0.7, -3.35, 0.78, '#84c978')
    this.addFlower(-2.2, 0.77, 2.5, '#f7c662')
    this.addFlower(2.2, 0.77, 2.7, '#ea8c91')
    this.addFlower(0.2, 0.77, 3.8, '#f1b469')

    const pebbleMaterial = new THREE.MeshStandardMaterial({ color: '#b8a27d', roughness: 1 })
    for (const [x, z, size] of [[-4.5, 0.5, 0.25], [4.3, 0.8, 0.31], [1.3, 4.1, 0.22], [-1.3, 3.8, 0.19]] as const) {
      const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), pebbleMaterial)
      pebble.position.set(x, 0.93, z)
      island.add(pebble)
    }
  }

  private buildCyclingRoad(): void {
    const road = new THREE.Mesh(
      new THREE.RingGeometry(3.25, 4.72, 96),
      new THREE.MeshStandardMaterial({ color: '#627b91', roughness: 0.98, side: THREE.DoubleSide }),
    )
    road.rotation.x = -Math.PI / 2
    road.position.y = 0.735
    this.scene.add(road)

    const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#fff4d8', roughness: 0.82, side: THREE.DoubleSide })
    for (const [inner, outer] of [[3.22, 3.29], [4.67, 4.74]] as const) {
      const edge = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), edgeMaterial)
      edge.rotation.x = -Math.PI / 2
      edge.position.y = 0.75
      this.scene.add(edge)
    }

    const stripeMaterial = new THREE.MeshStandardMaterial({ color: '#f7d77c', emissive: '#bd8a37', emissiveIntensity: 0.12, roughness: 0.65, side: THREE.DoubleSide })
    const stripe = new THREE.Mesh(new THREE.RingGeometry(3.94, 4.04, 96), stripeMaterial)
    stripe.rotation.x = -Math.PI / 2
    stripe.position.y = 0.755
    this.scene.add(stripe)

    const entry = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.065, 3.1),
      new THREE.MeshStandardMaterial({ color: '#e3bf78', roughness: 0.9 }),
    )
    entry.position.set(0, 0.755, 2.45)
    this.scene.add(entry)
  }

  private buildClouds(): void {
    const cloudMaterial = new THREE.MeshStandardMaterial({ color: '#f7fcff', roughness: 0.95 })
    const cloudPositions: [number, number, number, number][] = [
      [-10, 6.4, -2, 1.6], [9, 5.3, -5, 1.3], [-8, 4.5, 7, 1.1], [9, 7, 5, 1.7],
    ]
    for (const [x, y, z, scale] of cloudPositions) {
      const cloud = new THREE.Group()
      for (const [dx, dy, dz, size] of [[0, 0, 0, 0.75], [0.62, 0.08, 0.05, 0.58], [-0.55, 0.05, 0.02, 0.5], [0.12, 0.34, 0, 0.51]] as const) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 9), cloudMaterial)
        puff.position.set(dx, dy, dz)
        cloud.add(puff)
      }
      cloud.scale.setScalar(scale)
      cloud.position.set(x, y, z)
      this.scene.add(cloud)
      this.float(cloud, y, 0.2, 0.14)
    }
  }

  private addTree(x: number, ground: number, z: number, scale: number, leafColor: string): void {
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 0.9 * scale, 8),
      new THREE.MeshStandardMaterial({ color: '#92704c', roughness: 1 }),
    )
    trunk.position.y = 0.45 * scale
    tree.add(trunk)
    const leaves = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.54 * scale, 1),
      new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.92 }),
    )
    leaves.position.y = 1.02 * scale
    tree.add(leaves)
    const top = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.38 * scale, 0),
      new THREE.MeshStandardMaterial({ color: '#a5d779', roughness: 0.92 }),
    )
    top.position.set(0.12 * scale, 1.47 * scale, 0.02 * scale)
    tree.add(top)
    tree.position.set(x, ground, z)
    this.scene.add(tree)
    this.float(tree, ground, 0.035, 0.4)
  }

  private addFlower(x: number, ground: number, z: number, color: string): void {
    const flower = new THREE.Group()
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: '#458f60', roughness: 1 }),
    )
    stem.position.y = 0.21
    flower.add(stem)
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#ffe49a', roughness: 0.85 }),
    )
    center.position.y = 0.52
    flower.add(center)
    const petalMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), petalMaterial)
      petal.position.set(Math.cos(angle) * 0.17, 0.52, Math.sin(angle) * 0.17)
      flower.add(petal)
    }
    flower.position.set(x, ground, z)
    this.scene.add(flower)
  }

  private float(object: THREE.Object3D, y: number, amplitude: number, speed: number): void {
    this.floaters.push({ object, y, phase: this.floaters.length * 1.7, amplitude, speed })
  }
}
