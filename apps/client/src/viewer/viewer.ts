/**
 * viewer.ts
 *
 * Standalone voxel object viewer. Loads .vobj.json and .map (CLWF) files via
 * file picker or drag-and-drop, meshes them with the greedy mesher, and renders
 * with orbit controls.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { VoxelObjectDef } from '@clawfield/shared';
import { greedyMesh, quadsToGeometryData } from './mesher';

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

// --- Material classification types & tables (mirrors classify-materials.ts) ---

type MaterialType = 'glass' | 'wood' | 'concrete' | 'metal' | 'stone' | 'brick' | 'plastic' | 'unknown';

interface MaterialHealth { healthMultiplier: number; fragmentCount: number; style: string; }

const MATERIAL_HEALTH: Record<MaterialType, MaterialHealth> = {
  glass:    { healthMultiplier: 0.2, fragmentCount: 24, style: 'shards' },
  wood:     { healthMultiplier: 0.5, fragmentCount: 12, style: 'splinters' },
  concrete: { healthMultiplier: 1.0, fragmentCount: 18, style: 'chunks' },
  metal:    { healthMultiplier: 1.5, fragmentCount: 8,  style: 'twisted' },
  stone:    { healthMultiplier: 1.2, fragmentCount: 12, style: 'irregular' },
  brick:    { healthMultiplier: 0.8, fragmentCount: 20, style: 'bricks' },
  plastic:  { healthMultiplier: 0.3, fragmentCount: 10, style: 'pieces' },
  unknown:  { healthMultiplier: 1.0, fragmentCount: 12, style: 'chunks' },
};

const MAT_TYPE_COLORS: Record<MaterialType, string> = {
  glass: '#88ccff', wood: '#8B4513', concrete: '#888888', metal: '#c0c0c0',
  stone: '#a0a090', brick: '#b35c44', plastic: '#e0e040', unknown: '#555555',
};

const NAME_KEYWORDS: { keywords: string[]; type: MaterialType }[] = [
  { keywords: ['wood', 'timber', 'plank', 'bark'], type: 'wood' },
  { keywords: ['glass', 'window', 'transparent'], type: 'glass' },
  { keywords: ['metal', 'steel', 'iron', 'aluminum', 'chrome'], type: 'metal' },
  { keywords: ['concrete', 'cement'], type: 'concrete' },
  { keywords: ['stone', 'rock', 'marble', 'granite'], type: 'stone' },
  { keywords: ['brick'], type: 'brick' },
  { keywords: ['plastic', 'rubber'], type: 'plastic' },
];

function classifyByName(name: string): MaterialType | null {
  const lower = name.toLowerCase();
  for (const rule of NAME_KEYWORDS) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.type;
    }
  }
  return null;
}

function classifyByPBR(mat: THREE.MeshStandardMaterial): MaterialType | null {
  const metalness = mat.metalness ?? 0;
  const roughness = mat.roughness ?? 1;
  if (metalness > 0.7 && roughness < 0.3) return 'metal';
  if (mat.transparent || mat.opacity < 0.9) return 'glass';
  if (metalness < 0.3 && roughness > 0.6 && mat.color) {
    const hsl = { h: 0, s: 0, l: 0 };
    mat.color.getHSL(hsl);
    const hDeg = hsl.h * 360;
    if (hDeg >= 20 && hDeg <= 50 && hsl.s > 0.15) return 'wood';
    if (hsl.s < 0.15 && hsl.l >= 0.3 && hsl.l <= 0.6) return 'concrete';
    if (hsl.s < 0.15 && hsl.l > 0.6 && hsl.l <= 0.8) return 'stone';
  }
  return null;
}

function autoClassifyMesh(mesh: THREE.Mesh): MaterialType {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const matName = mat?.name ?? '';
  const meshName = mesh.name ?? '';
  const nameResult = classifyByName(matName) ?? classifyByName(meshName);
  if (nameResult) return nameResult;
  if (mat && 'metalness' in mat) {
    const pbrResult = classifyByPBR(mat);
    if (pbrResult) return pbrResult;
  }
  return 'unknown';
}

// --- Mesh registry for material tagging ---

interface MeshInfo {
  mesh: THREE.Mesh;
  name: string;
  materialName: string;
  autoType: MaterialType;
  taggedType: MaterialType | null; // null = use auto
  originalEmissive: THREE.Color;
}

let meshRegistry: MeshInfo[] = [];
let selectedMeshIndex = -1;
let glbFilename = '';
let glbLoaded = false;

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

// Material panel DOM refs
const materialPanel = document.getElementById('material-panel')!;
const meshListEl = document.getElementById('mesh-list')!;
const meshDetailEl = document.getElementById('mesh-detail')!;
const detailMeshName = document.getElementById('detail-mesh-name')!;
const detailMatName = document.getElementById('detail-mat-name')!;
const detailAutoType = document.getElementById('detail-auto-type')!;
const matTypeSelect = document.getElementById('mat-type-select') as HTMLSelectElement;
const detailHealth = document.getElementById('detail-health')!;
const detailFragments = document.getElementById('detail-fragments')!;
const saveMaterialsBtn = document.getElementById('save-materials-btn')!;
const loadMaterialsBtn = document.getElementById('load-materials-btn')!;
const loadInput = document.getElementById('load-input') as HTMLInputElement;

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
  const isVox = file.name.endsWith('.vox');
  const isGLB = file.name.endsWith('.glb') || file.name.endsWith('.gltf');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (isMap) {
        const { chunks, palette } = parseCLWFMap(reader.result as ArrayBuffer);
        displayMap(chunks, palette, file.name);
      } else if (isVox) {
        const { chunks, palette } = parseVoxFile(reader.result as ArrayBuffer);
        displayMap(chunks, palette, file.name);
      } else if (isGLB) {
        displayGLB(reader.result as ArrayBuffer, file.name);
      } else {
        const def = JSON.parse(reader.result as string) as VoxelObjectDef;
        displayModel(def);
      }
    } catch (err) {
      console.error('Failed to load file:', err);
      modelNameEl.textContent = `Error: ${(err as Error).message}`;
    }
  };
  if (isMap || isVox || isGLB) {
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

// --- MagicaVoxel .vox parser ---

function parseVoxFile(buffer: ArrayBuffer): CLWFMapData {
  const buf = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let off = 0;

  // Magic: "VOX " (4 bytes)
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'VOX ') throw new Error(`Not a .vox file (magic: "${magic}")`);
  off += 4;

  // Version
  off += 4; // skip version u32

  // MAIN chunk header
  off += 4; // "MAIN"
  off += 4; // main content size
  const mainChildSize = buf.getUint32(off, true); off += 4;

  const endOffset = off + mainChildSize;

  // Collect all models (SIZE+XYZI pairs)
  const models: { sx: number; sy: number; sz: number; voxels: { x: number; y: number; z: number; ci: number }[] }[] = [];
  let currentSize = { sx: 0, sy: 0, sz: 0 };
  const palette: number[] = new Array(256).fill(0);
  let hasPalette = false;

  while (off < endOffset && off < buffer.byteLength - 12) {
    const chunkId = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    off += 4;
    const contentSize = buf.getUint32(off, true); off += 4;
    off += 4; // child size
    const contentStart = off;

    if (chunkId === 'SIZE') {
      currentSize.sx = buf.getUint32(off, true);
      currentSize.sy = buf.getUint32(off + 4, true);
      currentSize.sz = buf.getUint32(off + 8, true);
    } else if (chunkId === 'XYZI') {
      const numVoxels = buf.getUint32(off, true);
      const voxels: { x: number; y: number; z: number; ci: number }[] = [];
      let voff = off + 4;
      for (let i = 0; i < numVoxels; i++) {
        const x = bytes[voff]; const y = bytes[voff + 1]; const z = bytes[voff + 2]; const ci = bytes[voff + 3];
        voxels.push({ x, y, z, ci });
        voff += 4;
      }
      models.push({ ...currentSize, voxels });
    } else if (chunkId === 'RGBA') {
      hasPalette = true;
      for (let i = 0; i < 256; i++) {
        const r = bytes[contentStart + i * 4];
        const g = bytes[contentStart + i * 4 + 1];
        const b = bytes[contentStart + i * 4 + 2];
        // .vox palette: index 0 in RGBA = palette slot 1 in usage
        const slot = (i + 1) & 0xff;
        palette[slot] = (r << 16) | (g << 8) | b;
      }
    }

    off = contentStart + contentSize;
  }

  // Default palette if none in file
  if (!hasPalette) {
    for (let i = 1; i < 256; i++) {
      const v = Math.floor((i / 255) * 255);
      palette[i] = (v << 16) | (v << 8) | v;
    }
  }

  // Convert all models into CLWF chunks.
  // MagicaVoxel axes: X=right, Y=depth, Z=up → remap to our X=right, Y=up, Z=depth
  const chunks = new Map<string, { cx: number; cy: number; cz: number; voxels: Uint8Array }>();

  for (const model of models) {
    for (const v of model.voxels) {
      // Remap: vox(x,y,z) → world(x, z, y) — Z-up to Y-up
      const wx = v.x;
      const wy = v.z;
      const wz = v.y;

      const cx = Math.floor(wx / 16);
      const cy = Math.floor(wy / 16);
      const cz = Math.floor(wz / 16);
      const key = `${cx},${cy},${cz}`;

      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = { cx, cy, cz, voxels: new Uint8Array(16 * 16 * 16) };
        chunks.set(key, chunk);
      }

      const lx = ((wx % 16) + 16) % 16;
      const ly = ((wy % 16) + 16) % 16;
      const lz = ((wz % 16) + 16) % 16;
      chunk.voxels[lx + ly * 16 + lz * 16 * 16] = v.ci;
    }
  }

  console.log(`.vox loaded: ${models.length} model(s), ${chunks.size} chunks, palette: ${hasPalette ? 'custom' : 'default'}`);
  return { chunks, palette };
}

// --- Display GLB/GLTF ---

function displayGLB(buffer: ArrayBuffer, filename: string) {
  clearCurrentObject();

  const loader = new GLTFLoader();
  loader.parse(buffer, '', (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    currentObject = model;

    // Frame camera
    const box = new THREE.Box3().setFromObject(model);
    frameCameraToBounds(box);

    // Gather stats + build mesh registry
    let triangleCount = 0;
    let vertexCount = 0;
    meshRegistry = [];
    selectedMeshIndex = -1;
    glbFilename = filename;
    glbLoaded = true;

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geom = child.geometry as THREE.BufferGeometry;
        vertexCount += geom.attributes.position?.count ?? 0;
        if (geom.index) {
          triangleCount += geom.index.count / 3;
        } else {
          triangleCount += (geom.attributes.position?.count ?? 0) / 3;
        }

        const mat = child.material as THREE.MeshStandardMaterial;
        const originalEmissive = mat?.emissive ? mat.emissive.clone() : new THREE.Color(0, 0, 0);

        const autoType = autoClassifyMesh(child);
        // Restore tagged type from GLB extras (userData) if present
        const savedType = child.userData?.materialType as MaterialType | undefined;
        const taggedType = savedType && savedType !== autoType ? savedType : null;
        const effectiveType = taggedType ?? autoType;
        // Always write effective type to userData for export
        child.userData.materialType = effectiveType;

        meshRegistry.push({
          mesh: child,
          name: child.name || `mesh_${meshRegistry.length}`,
          materialName: mat?.name || '(none)',
          autoType,
          taggedType,
          originalEmissive,
        });
      }
    });

    const size = new THREE.Vector3();
    box.getSize(size);

    modelNameEl.textContent = filename;
    infoDims.textContent = `Meshes: ${meshRegistry.length}`;
    infoVoxels.textContent = `Tris: ${Math.floor(triangleCount).toLocaleString()} | Verts: ${vertexCount.toLocaleString()}`;
    infoPalette.textContent = gltf.animations.length > 0 ? `Anims: ${gltf.animations.length}` : '';
    infoWorld.textContent = `Size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`;

    // Show material panel and populate mesh list
    showMaterialPanel();
  }, (err: unknown) => {
    console.error('GLB parse error:', err);
    modelNameEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  });
}

// --- Remove previous object ---

function clearCurrentObject() {
  if (!currentObject) return;
  scene.remove(currentObject);
  currentObject.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      // Dispose GLB materials (skip the shared voxel material)
      if (child.material && child.material !== material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        }
      }
    }
  });
  currentObject = null;
  meshRegistry = [];
  selectedMeshIndex = -1;
  glbLoaded = false;
  hideMaterialPanel();
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

    const { positions, normals, colors, uvs, ao, materialIds, indices } = quadsToGeometryData(quads, palette);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    geometry.setAttribute('materialId', new THREE.BufferAttribute(materialIds, 1));
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
  const { positions, normals, colors, uvs, ao, materialIds, indices } = quadsToGeometryData(quads, def.palette);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  geometry.setAttribute('materialId', new THREE.BufferAttribute(materialIds, 1));
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

// --- Material panel logic ---

const PANEL_WIDTH = 280;

function getCanvasWidth(): number {
  return glbLoaded ? window.innerWidth - PANEL_WIDTH : window.innerWidth;
}

function showMaterialPanel() {
  materialPanel.classList.add('visible');
  populateMeshList();
  meshDetailEl.classList.remove('visible');
  updateCanvasSize();
}

function hideMaterialPanel() {
  materialPanel.classList.remove('visible');
  meshListEl.innerHTML = '';
  meshDetailEl.classList.remove('visible');
  updateCanvasSize();
}

function updateCanvasSize() {
  const w = getCanvasWidth();
  camera.aspect = w / (window.innerHeight - 68);
  camera.updateProjectionMatrix();
  renderer.setSize(w, window.innerHeight - 68);
}

function getEffectiveType(info: MeshInfo): MaterialType {
  return info.taggedType ?? info.autoType;
}

function populateMeshList() {
  meshListEl.innerHTML = '';
  for (let i = 0; i < meshRegistry.length; i++) {
    const info = meshRegistry[i];
    const div = document.createElement('div');
    div.className = 'mesh-item';
    div.dataset.index = String(i);

    const dot = document.createElement('span');
    dot.className = 'mesh-dot';
    dot.style.background = MAT_TYPE_COLORS[getEffectiveType(info)];

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mesh-item-name';
    nameSpan.textContent = info.name;

    div.appendChild(dot);
    div.appendChild(nameSpan);
    div.addEventListener('click', () => selectMesh(i));
    meshListEl.appendChild(div);
  }
}

function selectMesh(index: number) {
  // Deselect previous
  if (selectedMeshIndex >= 0 && selectedMeshIndex < meshRegistry.length) {
    const prev = meshRegistry[selectedMeshIndex];
    const prevMat = prev.mesh.material as THREE.MeshStandardMaterial;
    if (prevMat?.emissive) prevMat.emissive.copy(prev.originalEmissive);
  }

  selectedMeshIndex = index;
  const info = meshRegistry[index];

  // Highlight selected mesh
  const mat = info.mesh.material as THREE.MeshStandardMaterial;
  if (mat?.emissive) mat.emissive.set(0x334488);

  // Update list selection styling
  const items = meshListEl.querySelectorAll('.mesh-item');
  items.forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });

  // Scroll the selected item into view
  items[index]?.scrollIntoView({ block: 'nearest' });

  // Show detail panel
  const effectiveType = getEffectiveType(info);
  const health = MATERIAL_HEALTH[effectiveType];

  detailMeshName.textContent = info.name;
  detailMatName.textContent = info.materialName;
  detailAutoType.textContent = info.autoType;
  matTypeSelect.value = effectiveType;
  detailHealth.textContent = `${health.healthMultiplier}x`;
  detailFragments.textContent = `${health.fragmentCount} (${health.style})`;

  meshDetailEl.classList.add('visible');
}

function updateDotColor(index: number) {
  const items = meshListEl.querySelectorAll('.mesh-item');
  const dot = items[index]?.querySelector('.mesh-dot') as HTMLElement | null;
  if (dot) {
    dot.style.background = MAT_TYPE_COLORS[getEffectiveType(meshRegistry[index])];
  }
}

// Material type dropdown change
matTypeSelect.addEventListener('change', () => {
  if (selectedMeshIndex < 0) return;
  const info = meshRegistry[selectedMeshIndex];
  const newType = matTypeSelect.value as MaterialType;

  // If setting back to auto-classified type, clear the override
  info.taggedType = newType === info.autoType ? null : newType;

  // Write to mesh userData so GLTFExporter preserves it as extras
  info.mesh.userData.materialType = newType;

  const health = MATERIAL_HEALTH[newType];
  detailHealth.textContent = `${health.healthMultiplier}x`;
  detailFragments.textContent = `${health.fragmentCount} (${health.style})`;

  updateDotColor(selectedMeshIndex);
});

// --- Raycaster for mesh picking ---

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

renderer.domElement.addEventListener('click', (e) => {
  if (flyMode || !glbLoaded || meshRegistry.length === 0) return;
  // Ignore right clicks (used for orbit/fly)
  if (e.button !== 0) return;

  const canvasW = getCanvasWidth();
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / canvasW) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / (window.innerHeight - 68)) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const allMeshes = meshRegistry.map(m => m.mesh);
  const intersects = raycaster.intersectObjects(allMeshes, false);

  if (intersects.length > 0) {
    const hitMesh = intersects[0].object as THREE.Mesh;
    const idx = meshRegistry.findIndex(m => m.mesh === hitMesh);
    if (idx >= 0) selectMesh(idx);
  }
});

// --- Save/Load .materials.json ---

saveMaterialsBtn.addEventListener('click', () => {
  if (!glbLoaded) return;

  const overrides: { meshName: string; materialType: MaterialType }[] = [];
  for (const info of meshRegistry) {
    if (info.taggedType !== null) {
      overrides.push({ meshName: info.name, materialType: info.taggedType });
    }
  }

  const data = {
    filename: glbFilename,
    overrides,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = glbFilename.replace(/\.(glb|gltf)$/i, '');
  a.download = `${baseName}.materials.json`;
  a.click();
  URL.revokeObjectURL(url);
});

loadMaterialsBtn.addEventListener('click', () => loadInput.click());

// --- Export GLB with material tags embedded as userData/extras ---

const exportGlbBtn = document.getElementById('export-glb-btn')!;
const overwriteCb = document.getElementById('overwrite-cb') as HTMLInputElement;

/** Track export version per filename so repeated exports increment */
let exportVersion = 0;
let exportVersionFile = '';

exportGlbBtn.addEventListener('click', async () => {
  if (!glbLoaded || !currentObject) return;

  const exporter = new GLTFExporter();
  const baseName = glbFilename.replace(/\.(glb|gltf)$/i, '');

  let downloadName: string;
  if (overwriteCb.checked) {
    downloadName = `${baseName}.glb`;
  } else {
    // Increment version counter (resets if a different file is loaded)
    if (exportVersionFile !== glbFilename) {
      exportVersion = 0;
      exportVersionFile = glbFilename;
    }
    exportVersion++;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadName = `${baseName}_v${exportVersion}_${ts}.glb`;
  }

  try {
    const glb = await exporter.parseAsync(currentObject, { binary: true });
    const blob = new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('GLB export failed:', err);
  }
});

loadInput.addEventListener('change', () => {
  const file = loadInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as {
        filename: string;
        overrides: { meshName: string; materialType: MaterialType }[];
      };

      for (const override of data.overrides) {
        const idx = meshRegistry.findIndex(m => m.name === override.meshName);
        if (idx >= 0) {
          const info = meshRegistry[idx];
          info.taggedType = override.materialType === info.autoType ? null : override.materialType;
          info.mesh.userData.materialType = override.materialType;
          updateDotColor(idx);
        }
      }

      // Refresh detail panel if a mesh is selected
      if (selectedMeshIndex >= 0) selectMesh(selectedMeshIndex);
    } catch (err) {
      console.error('Failed to load materials file:', err);
    }
  };
  reader.readAsText(file);
  loadInput.value = ''; // reset so same file can be re-loaded
});

// --- Resize ---

window.addEventListener('resize', () => {
  updateCanvasSize();
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
