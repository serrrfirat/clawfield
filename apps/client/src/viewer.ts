/**
 * viewer.ts
 *
 * Standalone voxel object viewer. Loads .vobj.json and .map (CLWF) files via
 * file picker or drag-and-drop, meshes them with the greedy mesher, and renders
 * with orbit controls.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VoxelObjectDef } from '@clawfield/shared';
import { greedyMesh, quadsToGeometryData } from './voxel/mesher';

// --- Three.js setup ---

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
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

let currentObject: THREE.Object3D | null = null;
let flyMode = false;
const flySpeed = 50; // units per second
const keysDown = new Set<string>();

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
  const isMap = file.name.endsWith('.map');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (isMap) {
        const { chunks, palette } = parseCLWFMap(reader.result as ArrayBuffer);
        displayMap(chunks, palette, file.name);
      } else {
        const def = JSON.parse(reader.result as string) as VoxelObjectDef;
        displayModel(def);
      }
    } catch (err) {
      console.error('Failed to load file:', err);
      modelNameEl.textContent = `Error: ${(err as Error).message}`;
    }
  };
  if (isMap) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

// --- CLWF binary map parser ---

interface CLWFMapData {
  chunks: Map<string, { cx: number; cy: number; cz: number; voxels: Uint8Array }>;
  palette: number[];
}

function parseCLWFMap(buffer: ArrayBuffer): CLWFMapData {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // Magic: "CLWF" (4 bytes)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'CLWF') {
    throw new Error(`Invalid map file: expected magic "CLWF", got "${magic}"`);
  }
  offset += 4;

  // Version: u8
  const version = view.getUint8(offset);
  offset += 1;
  if (version !== 1) {
    throw new Error(`Unsupported map version: ${version}`);
  }

  // Chunk count: u32 LE
  const chunkCount = view.getUint32(offset, true);
  offset += 4;

  // Palette size: u16 LE
  const paletteSize = view.getUint16(offset, true);
  offset += 2;

  // Palette: [r, g, b] x paletteSize
  const palette: number[] = new Array(paletteSize);
  for (let i = 0; i < paletteSize; i++) {
    const r = view.getUint8(offset);
    const g = view.getUint8(offset + 1);
    const b = view.getUint8(offset + 2);
    palette[i] = (r << 16) | (g << 8) | b;
    offset += 3;
  }

  // Chunks
  const CHUNK_VOXEL_COUNT = 16 * 16 * 16;
  const chunks = new Map<string, { cx: number; cy: number; cz: number; voxels: Uint8Array }>();

  for (let ci = 0; ci < chunkCount; ci++) {
    const cx = view.getInt16(offset, true);
    offset += 2;
    const cy = view.getInt16(offset, true);
    offset += 2;
    const cz = view.getInt16(offset, true);
    offset += 2;

    const voxels = new Uint8Array(CHUNK_VOXEL_COUNT);
    voxels.set(bytes.subarray(offset, offset + CHUNK_VOXEL_COUNT));
    offset += CHUNK_VOXEL_COUNT;

    const key = `${cx},${cy},${cz}`;
    chunks.set(key, { cx, cy, cz, voxels });
  }

  return { chunks, palette };
}

// --- Remove previous object ---

function clearCurrentObject() {
  if (!currentObject) return;
  scene.remove(currentObject);
  currentObject.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
    }
  });
  currentObject = null;
}

// --- Display .map file ---

function displayMap(
  chunks: Map<string, { cx: number; cy: number; cz: number; voxels: Uint8Array }>,
  palette: number[],
  filename: string,
) {
  clearCurrentObject();

  if (chunks.size === 0) {
    modelNameEl.textContent = 'Empty map';
    return;
  }

  const group = new THREE.Group();
  let totalVoxels = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const [, chunk] of chunks) {
    const { cx, cy, cz, voxels } = chunk;

    // Track world bounds
    const wx = cx * 16;
    const wy = cy * 16;
    const wz = cz * 16;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    minZ = Math.min(minZ, wz);
    maxX = Math.max(maxX, wx + 16);
    maxY = Math.max(maxY, wy + 16);
    maxZ = Math.max(maxZ, wz + 16);

    // Count non-empty voxels
    let hasVoxels = false;
    for (let i = 0; i < voxels.length; i++) {
      if (voxels[i] !== 0) {
        totalVoxels++;
        hasVoxels = true;
      }
    }
    if (!hasVoxels) continue;

    // Greedy mesh this chunk — skipWaterFilter=true: viewer doesn't know which
    // palette indices are water, so treat all non-zero voxels as solid
    const quads = greedyMesh(voxels, false, 16, 1, true);
    if (quads.length === 0) continue;

    const { positions, normals, colors, uvs, ao, indices } = quadsToGeometryData(quads, palette);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(wx, wy, wz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (group.children.length === 0) {
    modelNameEl.textContent = 'No visible voxels in map';
    return;
  }

  scene.add(group);
  currentObject = group;

  // Frame camera to fit the entire map
  const box = new THREE.Box3().setFromObject(group);
  frameCameraToBounds(box);

  // Update info panel
  modelNameEl.textContent = filename;
  infoDims.textContent = `Chunks: ${chunks.size}`;
  infoVoxels.textContent = `Voxels: ${totalVoxels.toLocaleString()}`;

  const usedColors = new Set<number>();
  for (const [, chunk] of chunks) {
    for (let i = 0; i < chunk.voxels.length; i++) {
      if (chunk.voxels[i] !== 0) usedColors.add(chunk.voxels[i]);
    }
  }
  infoPalette.textContent = `Colors: ${usedColors.size}`;

  const worldSizeX = maxX - minX;
  const worldSizeY = maxY - minY;
  const worldSizeZ = maxZ - minZ;
  infoWorld.textContent = `World: ${worldSizeX} x ${worldSizeY} x ${worldSizeZ}`;
}

// --- Meshing & display for .vobj.json (reuses greedy mesher from voxel/mesher.ts) ---

function displayModel(def: VoxelObjectDef) {
  clearCurrentObject();

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
  const { positions, normals, colors, uvs, ao, indices } = quadsToGeometryData(quads, def.palette);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  currentObject = mesh;

  // Frame camera to fit the model
  frameCameraToBounds(geometry.boundingBox!);

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

function frameCameraToBounds(box: THREE.Box3) {
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.5;

  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.6);
  camera.far = Math.max(5000, dist * 4);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

// --- Fly controls (WASD + QE + right-click look) ---

document.addEventListener('keydown', (e) => {
  keysDown.add(e.code);
  if (e.code === 'KeyF') {
    flyMode = !flyMode;
    controls.enabled = !flyMode;
  }
});
document.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

// Right-click drag to look around in fly mode
let isLooking = false;
let prevMouseX = 0;
let prevMouseY = 0;
const lookSensitivity = 0.003;

renderer.domElement.addEventListener('mousedown', (e) => {
  if (flyMode && e.button === 2) {
    isLooking = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) isLooking = false;
});
document.addEventListener('mousemove', (e) => {
  if (!isLooking || !flyMode) return;
  const dx = e.clientX - prevMouseX;
  const dy = e.clientY - prevMouseY;
  prevMouseX = e.clientX;
  prevMouseY = e.clientY;

  // Yaw (rotate around world Y)
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  euler.setFromQuaternion(camera.quaternion, 'YXZ');
  euler.y -= dx * lookSensitivity;
  euler.x -= dy * lookSensitivity;
  euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
  camera.quaternion.setFromEuler(euler);
});
renderer.domElement.addEventListener('contextmenu', (e) => {
  if (flyMode) e.preventDefault();
});

let prevTime = performance.now();

function updateFlyControls() {
  if (!flyMode) return;

  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  prevTime = now;

  const speed = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? flySpeed * 3 : flySpeed;
  const move = new THREE.Vector3();

  // Forward/back (W/S) along camera direction
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  if (keysDown.has('KeyW')) move.add(forward);
  if (keysDown.has('KeyS')) move.sub(forward);

  // Left/right (A/D) strafe
  const right = new THREE.Vector3();
  right.crossVectors(forward, camera.up).normalize();
  if (keysDown.has('KeyD')) move.add(right);
  if (keysDown.has('KeyA')) move.sub(right);

  // Up/down (Q/E or Space/Ctrl)
  if (keysDown.has('KeyE') || keysDown.has('Space')) move.y += 1;
  if (keysDown.has('KeyQ') || keysDown.has('ControlLeft')) move.y -= 1;

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    camera.position.add(move);
    controls.target.copy(camera.position).add(forward);
  }
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
  updateFlyControls();
  if (!flyMode) controls.update();
  prevTime = performance.now();
  renderer.render(scene, camera);
}
animate();
