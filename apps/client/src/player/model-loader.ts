import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const MODEL_PATH = '/models/soldier.glb';

/** Cached soldier template (original loaded model) */
let soldierTemplate: THREE.Group | null = null;
/** Cached animation clips from the loaded GLB */
let soldierAnimations: THREE.AnimationClip[] = [];
let loadingPromise: Promise<THREE.Group | null> | null = null;

/** Enable flat shading on all meshes in a scene graph */
function applyFlatShading(root: THREE.Object3D): void {
  root.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if ('flatShading' in mat) {
          (mat as THREE.MeshStandardMaterial).flatShading = true;
          mat.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * Load the soldier GLB model once and cache it.
 * Returns null if the model file is missing or fails to load.
 */
export function loadSoldierModel(): Promise<THREE.Group | null> {
  if (soldierTemplate) return Promise.resolve(soldierTemplate);
  if (loadingPromise) return loadingPromise;

  const loader = new GLTFLoader();
  loadingPromise = new Promise((resolve) => {
    loader.load(
      MODEL_PATH,
      (gltf: GLTF) => {
        soldierTemplate = gltf.scene;
        soldierAnimations = gltf.animations;
        applyFlatShading(soldierTemplate);
        console.log('Soldier model loaded successfully', `(${soldierAnimations.length} animations)`);
        resolve(soldierTemplate);
      },
      undefined,
      () => {
        console.warn('Could not load soldier model, falling back to box');
        loadingPromise = null;
        resolve(null);
      },
    );
  });

  return loadingPromise;
}

/**
 * Check if the soldier model has been loaded.
 */
export function isSoldierModelLoaded(): boolean {
  return soldierTemplate !== null;
}

/**
 * Create a clone of the soldier model, scaled to fit the player hitbox,
 * with materials tinted to the given team color.
 * Returns null if the model hasn't been loaded yet.
 */
export function createSoldierInstance(
  teamColor: number,
  playerHeight: number,
): THREE.Group | null {
  if (!soldierTemplate) return null;

  const instance = SkeletonUtils.clone(soldierTemplate) as THREE.Group;

  // Force world matrix update on the fresh clone before measuring
  instance.updateMatrixWorld(true);

  // Compute bounding box from visible meshes only — ignore IK helper bones
  // which extend far beyond the visible model and inflate the box
  const bbox = new THREE.Box3();
  instance.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const meshBox = mesh.geometry.boundingBox.clone();
        meshBox.applyMatrix4(mesh.matrixWorld);
        bbox.union(meshBox);
      }
    }
  });

  // Fallback if no meshes found
  if (bbox.isEmpty()) bbox.setFromObject(instance);

  const modelHeight = bbox.max.y - bbox.min.y;
  const scale = modelHeight > 0 ? playerHeight / modelHeight : 1;
  instance.scale.setScalar(scale);

  // Offset so the model's feet sit at y=0 (position represents feet)
  const scaledMinY = bbox.min.y * scale;
  instance.position.y = -scaledMinY;

  // Tint all meshes to team color and fix skinned mesh rendering
  const color = new THREE.Color(teamColor);
  instance.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      // Skinned meshes need frustum culling disabled — their bounding box
      // doesn't auto-update with skeleton pose, causing them to be culled
      mesh.frustumCulled = false;
      // Replace with a bright Lambert material tinted to team color for voxel-style look
      mesh.material = new THREE.MeshLambertMaterial({ color: teamColor });
    }
  });

  return instance;
}

/**
 * Get the cached animation clips from the loaded soldier model.
 */
export function getSoldierAnimations(): THREE.AnimationClip[] {
  return soldierAnimations;
}
