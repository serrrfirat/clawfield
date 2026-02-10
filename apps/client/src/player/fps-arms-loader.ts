import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const RIG_GLOCK_PATH = '/models/fps/fps_rig_glock.glb';
const RIG_AKM_PATH = '/models/fps/fps_rig_akm.glb';

/**
 * We use the rig files as arm templates (not the standalone arms file).
 * Each rig file has arms pre-posed for its weapon type, so animations
 * bind correctly without rest-pose mismatches.
 *
 * Template per set:
 *   pistol → fps_rig_glock.glb (arms + Glock mesh hidden)
 *   rifle  → fps_rig_akm.glb  (arms + AKM mesh hidden)
 */

/** Cached arm templates per weapon set (with weapon mesh hidden) */
const armsTemplates = new Map<'pistol' | 'rifle', THREE.Group>();

/** Animation clips by set id */
const animClips = new Map<'pistol' | 'rifle', THREE.AnimationClip[]>();

/** Names of weapon meshes to hide in each rig */
const WEAPON_MESH_NAMES: Record<string, string[]> = {
  pistol: ['Glock19'],
  rifle: ['AKM_model', 'AKMmodel'],
};

let loadingPromise: Promise<void> | null = null;

/**
 * Preload the rig GLBs. Each serves as both the arm template AND animation source.
 */
export function preloadFpsArms(): Promise<void> {
  if (loadingPromise) return loadingPromise;

  const loader = new GLTFLoader();

  const load = (path: string): Promise<GLTF | null> =>
    new Promise((resolve) => {
      loader.load(
        path,
        (gltf) => resolve(gltf),
        undefined,
        (err) => {
          console.warn(`[FpsArms] Failed to load: ${path}`, err);
          resolve(null);
        },
      );
    });

  loadingPromise = Promise.all([
    load(RIG_GLOCK_PATH),
    load(RIG_AKM_PATH),
  ]).then(([glockGltf, akmGltf]) => {
    if (glockGltf) {
      // Hide weapon meshes, keep arm meshes
      hideWeaponMeshes(glockGltf.scene, WEAPON_MESH_NAMES.pistol);
      armsTemplates.set('pistol', glockGltf.scene);
      animClips.set('pistol', glockGltf.animations);
      console.log(`[FpsArms] Pistol rig loaded (anims: ${glockGltf.animations.map((c) => c.name).join(', ')})`);
    }
    if (akmGltf) {
      hideWeaponMeshes(akmGltf.scene, WEAPON_MESH_NAMES.rifle);
      armsTemplates.set('rifle', akmGltf.scene);
      animClips.set('rifle', akmGltf.animations);
      console.log(`[FpsArms] Rifle rig loaded (anims: ${akmGltf.animations.map((c) => c.name).join(', ')})`);
    }
    console.log(`[FpsArms] Preload complete (pistol=${armsTemplates.has('pistol')}, rifle=${armsTemplates.has('rifle')})`);
  });

  return loadingPromise;
}

/** Hide weapon meshes by name (keep arms visible) */
function hideWeaponMeshes(scene: THREE.Group, names: string[]): void {
  const nameSet = new Set(names);
  scene.traverse((child) => {
    if (nameSet.has(child.name)) {
      child.visible = false;
      console.log(`[FpsArms] Hidden weapon mesh: ${child.name}`);
    }
  });
}

/** Whether at least one arm template loaded successfully */
export function isFpsArmsLoaded(): boolean {
  return armsTemplates.size > 0;
}

/**
 * Create a fresh clone of the arms for a specific weapon set.
 * Falls back to whatever set is available.
 */
export function createFpsArmsInstance(setId: 'pistol' | 'rifle'): THREE.Group | null {
  const template = armsTemplates.get(setId) ?? armsTemplates.values().next().value ?? null;
  if (!template) return null;
  return SkeletonUtils.clone(template) as THREE.Group;
}

/** Get animation clips for a weapon category */
export function getFpsAnimationClips(setId: 'pistol' | 'rifle'): THREE.AnimationClip[] {
  return animClips.get(setId) ?? [];
}

/** Get the loading promise (resolves when preload is done, or null if not started) */
export function getFpsArmsPromise(): Promise<void> | null {
  return loadingPromise;
}
