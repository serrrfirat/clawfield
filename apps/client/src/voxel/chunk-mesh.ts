import * as THREE from 'three';
import { greedyMesh, quadsToGeometryData } from './mesher';

/**
 * Build a Three.js BufferGeometry from chunk voxel data using greedy meshing.
 */
export function buildChunkGeometry(voxels: Uint8Array): THREE.BufferGeometry | null {
  const quads = greedyMesh(voxels);
  if (quads.length === 0) return null;

  const { positions, normals, colors, indices } = quadsToGeometryData(quads);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}
