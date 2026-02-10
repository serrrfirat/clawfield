import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WeaponId } from '@clawfield/shared';

/**
 * Maps weapon IDs to their GLB file paths (relative to public/).
 * Only weapons with actual GLB models are listed here.
 * Missing weapons will fall back to procedural geometry.
 */
const WEAPON_MODEL_PATHS: Partial<Record<WeaponId, string>> = {
  [WeaponId.AssaultRifle]: '/models/weapons/assault_rifle.glb',
  [WeaponId.SMG_Assault]: '/models/weapons/smg_assault.glb',
  [WeaponId.SMG_Medic]: '/models/weapons/smg_medic.glb',
  [WeaponId.Shotgun]: '/models/weapons/shotgun.glb',
  [WeaponId.Carbine]: '/models/weapons/carbine.glb',
  [WeaponId.PDW]: '/models/weapons/pdw.glb',
  [WeaponId.SniperRifle]: '/models/weapons/sniper_rifle.glb',
  [WeaponId.DMR]: '/models/weapons/dmr.glb',
};

/** Cached loaded weapon scenes keyed by WeaponId */
const weaponCache = new Map<WeaponId, THREE.Group>();

/** Track loading state */
let loadingPromise: Promise<void> | null = null;

/**
 * Preload all GLB weapon models. Call once at startup.
 * Non-blocking — weapons that fail to load will silently fall back to procedural.
 */
export function preloadWeaponModels(): Promise<void> {
  if (loadingPromise) return loadingPromise;

  const loader = new GLTFLoader();
  const entries = Object.entries(WEAPON_MODEL_PATHS) as [WeaponId, string][];

  loadingPromise = Promise.all(
    entries.map(
      ([weaponId, modelPath]) =>
        new Promise<void>((resolve) => {
          loader.load(
            modelPath,
            (gltf: GLTF) => {
              const scene = gltf.scene;
              weaponCache.set(weaponId, scene);
              console.log(`[WeaponLoader] Loaded: ${weaponId} (${modelPath})`);
              resolve();
            },
            undefined,
            (err) => {
              console.warn(`[WeaponLoader] Failed: ${weaponId} (${modelPath})`, err);
              resolve(); // Don't block other weapons
            },
          );
        }),
    ),
  ).then(() => {
    console.log(`[WeaponLoader] ${weaponCache.size}/${entries.length} models ready`);
  });

  return loadingPromise;
}

/**
 * Get a clone of a loaded weapon GLB scene, scaled and oriented for viewmodel use.
 * Returns a THREE.Group ready to be added to the weapon group, or null if not loaded.
 */
export function getWeaponModelGroup(weaponId: WeaponId): THREE.Group | null {
  const template = weaponCache.get(weaponId);
  if (!template) return null;

  const clone = template.clone();

  // Force matrix update so bounding box is accurate
  clone.updateMatrixWorld(true);

  // Compute bounding box to normalize size
  const bbox = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // The procedural shotgun spans roughly 0.5 units along Z (barrel axis).
  // Scale the GLB to match.
  const targetLength = 0.55;
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? targetLength / maxDim : 1;

  // Wrap in a positioning group so scale+offset don't conflict with weaponGroup transforms
  const wrapper = new THREE.Group();
  wrapper.add(clone);

  // Scale the wrapper
  wrapper.scale.setScalar(scale);

  // Rotate so barrel points forward (-Z).
  wrapper.rotation.y = Math.PI / 2;

  // Center the model so it sits at origin (where procedural weapons sit)
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  clone.position.set(-center.x, -center.y, -center.z);

  return wrapper;
}

/**
 * Check if a weapon has a loaded GLB model available.
 */
export function hasWeaponModel(weaponId: WeaponId): boolean {
  return weaponCache.has(weaponId);
}
