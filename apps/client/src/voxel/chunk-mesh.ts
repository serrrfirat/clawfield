import * as THREE from 'three';
import { CHUNK_SIZE } from '@clawfield/shared';
import { greedyMesh, quadsToGeometryData } from './mesher';
import { downsampleChunk, lodFactor } from './lod';

/**
 * Build a Three.js BufferGeometry from chunk voxel data using greedy meshing.
 * Only builds solid (non-water) geometry.
 *
 * @param voxels - Full-resolution 16^3 voxel data
 * @param lodLevel - 0 = full detail, 1 = half (8^3), 2 = quarter (4^3)
 */
export function buildChunkGeometry(voxels: Uint8Array, lodLevel: number = 0): THREE.BufferGeometry | null {
  const factor = lodFactor(lodLevel);
  const gridSize = CHUNK_SIZE / factor;
  const downsampled = downsampleChunk(voxels, factor);

  const quads = greedyMesh(downsampled, false, gridSize, factor);
  if (quads.length === 0) return null;

  const { positions, normals, colors, uvs, indices } = quadsToGeometryData(quads);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

/**
 * Build a Three.js BufferGeometry for water voxels only.
 *
 * @param voxels - Full-resolution 16^3 voxel data
 * @param lodLevel - 0 = full detail, 1 = half (8^3), 2 = quarter (4^3)
 */
export function buildWaterGeometry(voxels: Uint8Array, lodLevel: number = 0): THREE.BufferGeometry | null {
  const factor = lodFactor(lodLevel);
  const gridSize = CHUNK_SIZE / factor;
  const downsampled = downsampleChunk(voxels, factor);

  const quads = greedyMesh(downsampled, true, gridSize, factor);
  if (quads.length === 0) return null;

  const { positions, normals, colors, uvs, indices } = quadsToGeometryData(quads);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}
