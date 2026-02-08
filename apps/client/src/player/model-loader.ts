import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = '/models/soldier.glb';

/** Cached soldier template (original loaded model) */
let soldierTemplate: THREE.Group | null = null;
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
        applyFlatShading(soldierTemplate);
        console.log('Soldier model loaded successfully');
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

  const instance = soldierTemplate.clone();

  // Compute bounding box of the template to scale it to player height
  const bbox = new THREE.Box3().setFromObject(instance);
  const modelHeight = bbox.max.y - bbox.min.y;
  const scale = modelHeight > 0 ? playerHeight / modelHeight : 1;
  instance.scale.setScalar(scale);

  // Offset so the model's feet sit at y=0 (position represents feet)
  const scaledMinY = bbox.min.y * scale;
  instance.position.y = -scaledMinY;

  // Tint all meshes to team color
  const color = new THREE.Color(teamColor);
  instance.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (let i = 0; i < materials.length; i++) {
        const orig = materials[i] as THREE.MeshStandardMaterial;
        const mat = orig.clone();
        // Blend the team color with the original model color
        mat.color.lerp(color, 0.6);
        mat.flatShading = true;
        mat.needsUpdate = true;
        if (Array.isArray(mesh.material)) {
          mesh.material[i] = mat;
        } else {
          mesh.material = mat;
        }
      }
    }
  });

  return instance;
}
