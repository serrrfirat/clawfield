import * as THREE from 'three'
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata'
import type { Vec3 } from '@clawfield/shared'
import useStore from '../stores/useStore'

const GRAVITY = -4

interface PlacementEntry {
  id: string
  object: THREE.Object3D
  radius: number
  destroyed: boolean
  onDestroyed?: () => void
  baseColor: THREE.Color
  groundY?: number
}

interface ActiveFragment {
  mesh: THREE.Object3D
  velocity: THREE.Vector3
  angular: THREE.Vector3
  life: number
  ttl: number
  groundY: number
  clearance: number
  body?: any
}

interface RegisterPlacementOptions {
  onDestroyed?: () => void
  baseColor?: THREE.ColorRepresentation
  groundY?: number
  destroyed?: boolean
}

interface PendingDestroyedEvent {
  position: Vec3
  impulse: Vec3
  createdAt: number
}

const PENDING_DESTROY_TTL_MS = 5000

class PlacementDestructionView {
  private placements = new Map<string, PlacementEntry>()
  private pendingDestroyedById = new Map<string, PendingDestroyedEvent>()
  private fragments: ActiveFragment[] = []
  private tempVec = new THREE.Vector3()
  private scene: THREE.Scene | null = null
  private heightGetter: ((x: number, z: number) => number) | null = null
  private physicsWorld: any = null
  private rapier: any = null

  private getRubbleParams() {
    const p = (useStore.getState() as any).rubbleParameters ?? {}
    return {
      physicsEnabled: p.physicsEnabled !== false,
      maxFragments: Math.max(50, Math.floor(p.maxFragments ?? 420)),
      ttlSec: Math.max(5, Number(p.ttlSec ?? 90)),
      colliderScale: Math.max(0.12, Number(p.colliderScale ?? 0.32)),
      linearDamping: Math.max(0, Number(p.linearDamping ?? 1.4)),
      angularDamping: Math.max(0, Number(p.angularDamping ?? 2.6)),
      friction: Math.max(0, Number(p.friction ?? 1.15)),
      restitution: Math.max(0, Number(p.restitution ?? 0.04)),
    }
  }

  private getPlayableBounds() {
    const state = useStore.getState() as any
    const bounds = state.matchConfig?.bounds
    if (!bounds) return null
    return {
      minX: Number(bounds.minX),
      maxX: Number(bounds.maxX),
      minZ: Number(bounds.minZ),
      maxZ: Number(bounds.maxZ),
    }
  }

  setScene(scene: THREE.Scene | null): void {
    this.scene = scene
  }

  setHeightGetter(getter: ((x: number, z: number) => number) | null): void {
    this.heightGetter = getter
  }

  setPhysicsWorld(world: any, rapier: any): void {
    this.physicsWorld = world
    this.rapier = rapier
  }

  registerPlacement(id: string, object: THREE.Object3D, radius: number, options: RegisterPlacementOptions = {}): void {
    this.prunePendingDestroyed()
    const prev = this.placements.get(id)
    const nextColor = new THREE.Color(options.baseColor ?? prev?.baseColor ?? '#8a8a8a')
    const pendingDestroyed = this.pendingDestroyedById.get(id)
    const destroyed = prev ? prev.destroyed : options.destroyed === true || Boolean(pendingDestroyed)
    object.visible = !destroyed
    this.placements.set(id, {
      id,
      object,
      radius: Math.max(0.2, radius),
      destroyed,
      onDestroyed: options.onDestroyed,
      baseColor: nextColor,
      groundY: Number.isFinite(options.groundY as number) ? options.groundY : prev?.groundY,
    })

    if (pendingDestroyed) {
      this.pendingDestroyedById.delete(id)
      this.handleDestroyedPlacement(id, pendingDestroyed.position, pendingDestroyed.impulse)
    }
  }

  unregisterPlacement(id: string): void {
    this.placements.delete(id)
  }

  clear(): void {
    this.placements.clear()
    this.pendingDestroyedById.clear()
    for (const f of this.fragments) {
      this.disposeFragment(f)
    }
    this.fragments = []
  }

  handleImpact(position: Vec3, impulse: Vec3): void {
    const hit = new THREE.Vector3(position.x, position.y, position.z)
    console.log('[pinata] impact', { x: position.x.toFixed(2), y: position.y.toFixed(2), z: position.z.toFixed(2) }, 'registered=', this.placements.size)

    let best: PlacementEntry | null = null
    let bestDistSq = Infinity

    for (const entry of this.placements.values()) {
      if (entry.destroyed || !entry.object.visible) continue
      const objPos = entry.object.getWorldPosition(this.tempVec)
      const dx = hit.x - objPos.x
      const dz = hit.z - objPos.z
      const distSq = dx * dx + dz * dz
      if (distSq > entry.radius * entry.radius * 3.2) continue

      const dy = Math.abs(hit.y - objPos.y)
      if (dy > Math.max(10, entry.radius * 4.5)) continue

      if (distSq < bestDistSq) {
        bestDistSq = distSq
        best = entry
      }
    }

    if (!best) {
      console.log('[pinata] no registered placement matched impact')
      return
    }
    this.fracturePlacement(best, hit, impulse)
  }

  handleDestroyedPlacement(id: string, position: Vec3, impulse: Vec3): void {
    this.prunePendingDestroyed()
    const entry = this.placements.get(id)
    if (!entry) {
      this.pendingDestroyedById.set(id, {
        position,
        impulse,
        createdAt: Date.now(),
      })
      this.handleImpact(position, impulse)
      return
    }
    if (entry.destroyed) return
    this.fracturePlacement(
      entry,
      new THREE.Vector3(position.x, position.y, position.z),
      impulse,
    )
  }

  private prunePendingDestroyed(): void {
    const now = Date.now()
    for (const [id, evt] of this.pendingDestroyedById) {
      if (now - evt.createdAt > PENDING_DESTROY_TTL_MS) {
        this.pendingDestroyedById.delete(id)
      }
    }
  }

  update(dt: number): void {
    if (this.fragments.length === 0) return

    const clamped = Math.min(0.05, Math.max(0.001, dt))

    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i]
      f.life += clamped

      if (f.body) {
        const t = f.body.translation()
        const r = f.body.rotation()
        let x = t.x
        let y = t.y
        let z = t.z

        const bounds = this.getPlayableBounds()
        if (bounds) {
          const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, x))
          const clampedZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, z))
          if (clampedX !== x || clampedZ !== z) {
            x = clampedX
            z = clampedZ
            const v = f.body.linvel()
            f.body.setLinvel({ x: v.x * -0.18, y: Math.max(0, v.y), z: v.z * -0.18 }, true)
          }
        }

        const terrainY = this.heightGetter ? this.heightGetter(x, z) : f.groundY
        const floorY = Math.max(f.groundY, terrainY + f.clearance)
        if (y < floorY - 0.02) {
          y = floorY
          const v = f.body.linvel()
          f.body.setLinvel({ x: v.x * 0.75, y: Math.max(0, -v.y * 0.15), z: v.z * 0.75 }, true)
        }

        f.body.setTranslation({ x, y, z }, true)
        f.mesh.position.set(x, y, z)
        f.mesh.quaternion.set(r.x, r.y, r.z, r.w)

        if (f.life >= f.ttl) {
          this.disposeFragment(f)
          this.fragments.splice(i, 1)
        }
        continue
      }

      f.velocity.y += GRAVITY * clamped
      f.mesh.position.x += f.velocity.x * clamped
      f.mesh.position.y += f.velocity.y * clamped
      f.mesh.position.z += f.velocity.z * clamped

      const terrainY = this.heightGetter ? this.heightGetter(f.mesh.position.x, f.mesh.position.z) : f.groundY
      const floorY = Math.max(f.groundY, terrainY + f.clearance)
      if (f.mesh.position.y < floorY) {
        f.mesh.position.y = floorY
        if (f.velocity.y < 0) f.velocity.y *= -0.18
        f.velocity.x *= 0.8
        f.velocity.z *= 0.8
        f.angular.multiplyScalar(0.86)
        if (Math.abs(f.velocity.y) < 0.06) f.velocity.y = 0
      }

      f.mesh.rotation.x += f.angular.x * clamped
      f.mesh.rotation.y += f.angular.y * clamped
      f.mesh.rotation.z += f.angular.z * clamped

      if (f.life >= f.ttl) {
        this.disposeFragment(f)
        this.fragments.splice(i, 1)
      }
    }
  }

  private registerFragment(fragment: ActiveFragment): void {
    const { maxFragments } = this.getRubbleParams()
    while (this.fragments.length >= maxFragments) {
      const oldest = this.fragments.shift()
      if (oldest) this.disposeFragment(oldest)
    }
    this.fragments.push(fragment)
  }

  private createPhysicsBodyForMesh(mesh: THREE.Object3D, velocity: THREE.Vector3, angular: THREE.Vector3): any {
    const params = this.getRubbleParams()
    if (!params.physicsEnabled || !this.physicsWorld || !this.rapier) return null

    const rbDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel({ x: angular.x * 0.35, y: angular.y * 0.35, z: angular.z * 0.35 })
      .setLinearDamping(params.linearDamping)
      .setAngularDamping(params.angularDamping)

    const body = this.physicsWorld.createRigidBody(rbDesc)
    body.enableCcd(true)

    const box = new THREE.Box3().setFromObject(mesh)
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(0.06, Math.max(size.x, size.y, size.z) * params.colliderScale)
    const colDesc = this.rapier.ColliderDesc.ball(radius)
      .setFriction(params.friction)
      .setRestitution(params.restitution)
      .setDensity(1.5)
    this.physicsWorld.createCollider(colDesc, body)

    return body
  }

  private getSceneForObject(obj: THREE.Object3D | null): THREE.Scene | null {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      if ((cur as THREE.Scene).isScene) return cur as THREE.Scene
      cur = cur.parent
    }
    return null
  }

  private computeFragmentCount(entry: PlacementEntry, sourceMesh: THREE.Mesh | null): number {
    let sizeScore = entry.radius

    if (sourceMesh) {
      const bb = new THREE.Box3().setFromObject(sourceMesh)
      const size = bb.getSize(new THREE.Vector3())
      const volume = Math.max(0.001, size.x * size.y * size.z)
      sizeScore = Math.max(sizeScore, Math.cbrt(volume))
    }

    const fragments = Math.round(8 + sizeScore * 12)
    return Math.max(8, Math.min(48, fragments))
  }

  private spawnFallbackShards(
    scene: THREE.Scene,
    sourceMesh: THREE.Mesh | null,
    entry: PlacementEntry,
    worldPos: THREE.Vector3,
    impulse: Vec3,
  ): void {
    const size = new THREE.Vector3(entry.radius * 1.5, entry.radius * 1.25, entry.radius * 1.5)
    let color = new THREE.Color('#9b9b9b')

    if (sourceMesh) {
      const bb = new THREE.Box3().setFromObject(sourceMesh)
      bb.getSize(size)
      const srcMat = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material
      const srcColor = (srcMat as any)?.color
      if (srcColor && srcColor.isColor) {
        const gray = (srcColor.r + srcColor.g + srcColor.b) / 3
        color = new THREE.Color(gray, gray, gray).multiplyScalar(1.12)
      }
    }

    const count = this.computeFragmentCount(entry, sourceMesh)
    const floorY = entry.groundY ?? (worldPos.y - Math.max(0.2, entry.radius * 0.45))
    const { ttlSec } = this.getRubbleParams()

    for (let i = 0; i < count; i++) {
      const gx = Math.max(0.08, size.x * (0.16 + Math.random() * 0.2))
      const gy = Math.max(0.08, size.y * (0.16 + Math.random() * 0.2))
      const gz = Math.max(0.08, size.z * (0.16 + Math.random() * 0.2))
      const geom = new THREE.BoxGeometry(gx, gy, gz)
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 })
      const shard = new THREE.Mesh(geom, mat)
      shard.castShadow = true
      shard.receiveShadow = true
      shard.position.set(
        worldPos.x + (Math.random() - 0.5) * size.x * 0.45,
        worldPos.y + (Math.random() - 0.2) * size.y * 0.45,
        worldPos.z + (Math.random() - 0.5) * size.z * 0.45,
      )
      scene.add(shard)

      const impulseDir = new THREE.Vector3(impulse.x, impulse.y, impulse.z)
      if (impulseDir.lengthSq() < 1e-4) impulseDir.set(0, 0.25, 1)
      impulseDir.normalize()
      const vel = impulseDir
        .multiplyScalar(2.8 + Math.random() * 2.8)
        .add(new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 1.4 + 0.25, (Math.random() - 0.5) * 1.4))
      const angular = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9)

      const body = this.createPhysicsBodyForMesh(shard, vel, angular)
      this.registerFragment({
        mesh: shard,
        velocity: vel,
        angular,
        life: 0,
        ttl: ttlSec,
        groundY: floorY,
        clearance: Math.max(0.04, gy * 0.4),
        body,
      })
    }
  }

  private fracturePlacement(entry: PlacementEntry, worldHit: THREE.Vector3, impulse: Vec3): void {
    const scene = this.getSceneForObject(entry.object) ?? this.scene
    if (!scene) return

    const baseWorldPos = entry.object.getWorldPosition(new THREE.Vector3())
    const sourceMesh = this.pickPrimaryMesh(entry.object)

    if (!sourceMesh) {
      console.log('[pinata] fallback shards (no source mesh)', entry.id)
      this.spawnFallbackShards(scene, null, entry, baseWorldPos, impulse)
      entry.object.visible = false
      entry.destroyed = true
      entry.onDestroyed?.()
      return
    }

    const geometry = sourceMesh.geometry.clone()
    const srcMat = Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material
    const outerMaterial = (srcMat?.clone?.() as THREE.Material | undefined)
      ?? new THREE.MeshStandardMaterial({ color: '#9b9b9b' })
    const innerMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7f7f7f'), roughness: 1, metalness: 0 })

    const destructible = new DestructibleMesh(geometry, outerMaterial, innerMaterial)

    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    const worldScale = new THREE.Vector3()
    sourceMesh.matrixWorld.decompose(worldPos, worldQuat, worldScale)

    destructible.position.copy(worldPos)
    destructible.quaternion.copy(worldQuat)
    destructible.scale.copy(worldScale)
    destructible.updateMatrixWorld(true)

    const localImpact = destructible.worldToLocal(worldHit.clone())
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: this.computeFragmentCount(entry, sourceMesh),
      voronoiOptions: {
        mode: '3D',
        impactPoint: localImpact,
        impactRadius: Math.max(0.2, entry.radius * 0.8),
      },
    })

    let fragments: DestructibleMesh[] = []
    try {
      fragments = destructible.fracture(options)
    } catch {
      console.log('[pinata] fracture threw, using fallback shards', entry.id)
      this.spawnFallbackShards(scene, sourceMesh, entry, worldPos, impulse)
      entry.object.visible = false
      entry.destroyed = true
      entry.onDestroyed?.()
      destructible.dispose()
      return
    }

    if (fragments.length === 0) {
      console.log('[pinata] fracture returned 0 fragments, using fallback', entry.id)
      this.spawnFallbackShards(scene, sourceMesh, entry, worldPos, impulse)
      entry.object.visible = false
      entry.destroyed = true
      entry.onDestroyed?.()
      destructible.dispose()
      return
    }

    entry.object.visible = false
    entry.destroyed = true
    entry.onDestroyed?.()
    console.log('[pinata] fractured placement', entry.id)

    const impulseDir = new THREE.Vector3(impulse.x, impulse.y, impulse.z)
    if (impulseDir.lengthSq() < 1e-4) impulseDir.set(0, 0.2, 1)
    impulseDir.normalize()

    const floorY = entry.groundY ?? (worldPos.y - Math.max(0.2, entry.radius * 0.45))
    const { ttlSec } = this.getRubbleParams()

    for (let i = 0; i < fragments.length; i++) {
      const frag = fragments[i]
      frag.castShadow = true
      frag.receiveShadow = true
      scene.add(frag)

      const random = new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.2 + 0.2, (Math.random() - 0.5) * 1.2)
      const vel = impulseDir.clone().multiplyScalar(3.2 + Math.random() * 2.8).add(random)
      const angular = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      )

      const fragMesh = frag as unknown as THREE.Mesh
      let fragClearance = 0.08
      if (fragMesh.geometry) {
        fragMesh.geometry.computeBoundingBox()
        const bb = fragMesh.geometry.boundingBox
        if (bb) {
          const size = bb.getSize(new THREE.Vector3())
          fragClearance = Math.max(0.04, size.y * Math.max(1, fragMesh.scale.y) * 0.35)
        }
      }

      const body = this.createPhysicsBodyForMesh(frag, vel, angular)
      this.registerFragment({
        mesh: frag,
        velocity: vel,
        angular,
        life: 0,
        ttl: ttlSec,
        groundY: floorY,
        clearance: fragClearance,
        body,
      })
    }

    destructible.dispose()
  }

  private pickPrimaryMesh(root: THREE.Object3D): THREE.Mesh | null {
    let best: THREE.Mesh | null = null
    let bestScore = -Infinity

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return

      mesh.geometry.computeBoundingBox()
      const bb = mesh.geometry.boundingBox
      if (!bb) return
      const size = new THREE.Vector3()
      bb.getSize(size)
      const score = size.x * size.y * size.z
      if (score > bestScore) {
        bestScore = score
        best = mesh
      }
    })

    return best
  }

  private disposeFragment(fragment: ActiveFragment): void {
    if (fragment.body && this.physicsWorld) {
      this.physicsWorld.removeRigidBody(fragment.body)
    }

    const obj = fragment.mesh
    obj.parent?.remove(obj)
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose()
    } else if (mat) {
      mat.dispose()
    }
  }
}

export const placementDestructionView = new PlacementDestructionView()
