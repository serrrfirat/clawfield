/**
 * viewer.ts
 *
 * Standalone voxel object viewer. Loads .vobj.json files via file picker or
 * drag-and-drop, meshes them with the greedy mesher, and renders with orbit controls.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VoxelObjectDef } from '@clawfield/shared';
import { greedyMesh, quadsToGeometryData } from './voxel/mesher';

// --- Three.js setup ---

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(5, 5, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight - 68); // account for top+bottom bars
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.marginTop = '40px';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

// --- Lighting ---

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 15, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// --- Grid ---

const grid = new THREE.GridHelper(50, 50, 0x444466, 0x2a2a44);
scene.add(grid);

// --- Material ---

const material = new THREE.MeshStandardMaterial({ vertexColors: true });

// --- State ---

let currentMesh: THREE.Mesh | null = null;

// --- DOM refs ---

const fileBtn = document.getElementById('file-btn')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const modelNameEl = document.getElementById('model-name')!;
const wireframeCb = document.getElementById('wireframe-cb') as HTMLInputElement;
const infoDims = document.getElementById('info-dims')!;
const infoVoxels = document.getElementById('info-voxels')!;
const infoPalette = document.getElementById('info-palette')!;
const infoWorld = document.getElementById('info-world')!;
const dropOverlay = document.getElementById('drop-overlay')!;

// --- File loading ---

fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

// Wireframe toggle
wireframeCb.addEventListener('change', () => {
  material.wireframe = wireframeCb.checked;
});

// Drag and drop
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.style.display = 'flex';
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.style.display = 'none';
  }
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.style.display = 'none';
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

function loadFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const def = JSON.parse(reader.result as string) as VoxelObjectDef;
      displayModel(def);
    } catch (err) {
      console.error('Failed to parse .vobj.json:', err);
      modelNameEl.textContent = 'Error: invalid JSON';
    }
  };
  reader.readAsText(file);
}

// --- Meshing & display (reuses greedy mesher from voxel/mesher.ts) ---

function displayModel(def: VoxelObjectDef) {
  // Remove previous mesh
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh = null;
  }

  const { sizeX, sizeY, sizeZ, voxelSize } = def;
  const gridSize = Math.max(sizeX, sizeY, sizeZ);
  if (gridSize === 0) {
    modelNameEl.textContent = 'Empty model';
    return;
  }

  // Pad voxels into a cubic array (greedy mesher requires cubic grids)
  const padded = new Uint8Array(gridSize * gridSize * gridSize);
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const srcIdx = x + y * sizeX + z * sizeX * sizeY;
        const dstIdx = x + y * gridSize + z * gridSize * gridSize;
        padded[dstIdx] = def.voxels[srcIdx];
      }
    }
  }

  // Greedy mesh with the object's voxel size as scale
  // skipWaterFilter=true: object palette indices are unrelated to terrain water IDs
  const quads = greedyMesh(padded, false, gridSize, voxelSize, true);
  if (quads.length === 0) {
    modelNameEl.textContent = 'No visible voxels';
    return;
  }

  // Convert quads to geometry using the object's palette
  const { positions, normals, colors, uvs, indices } = quadsToGeometryData(quads, def.palette);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  currentMesh = mesh;

  // Frame camera to fit the model
  frameCameraToModel(geometry);

  // Update info panel
  modelNameEl.textContent = def.name;
  infoDims.textContent = `Grid: ${sizeX} x ${sizeY} x ${sizeZ}`;

  const voxelCount = def.voxels.filter((v: number) => v !== 0).length;
  infoVoxels.textContent = `Voxels: ${voxelCount.toLocaleString()}`;

  const usedColors = new Set(def.voxels.filter((v: number) => v !== 0));
  infoPalette.textContent = `Colors: ${usedColors.size}`;

  const worldX = (sizeX * voxelSize).toFixed(1);
  const worldY = (sizeY * voxelSize).toFixed(1);
  const worldZ = (sizeZ * voxelSize).toFixed(1);
  infoWorld.textContent = `World: ${worldX} x ${worldY} x ${worldZ}m`;
}

function frameCameraToModel(geometry: THREE.BufferGeometry) {
  const box = geometry.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5;

  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.6);
  controls.target.copy(center);
  controls.update();
}

// --- Resize ---

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / (window.innerHeight - 68);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight - 68);
});

// --- Render loop ---

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
