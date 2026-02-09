import * as THREE from 'three';

/**
 * Per-chunk water face sorter for correct transparency rendering.
 *
 * Sorts water quads (6 indices = 2 triangles each) back-to-front
 * relative to the camera. Uses pre-allocated typed arrays to avoid GC.
 * Skips sorting when camera hasn't moved significantly.
 */
export class WaterFaceSorter {
  /** Pre-computed centroids for each quad (3 floats per quad) */
  private centroids: Float32Array;
  /** Original index data (never mutated, used as source for sorting) */
  private sourceIndices: Uint32Array;
  /** Number of quads (index count / 6) */
  private quadCount: number;
  /** Last camera position used for sorting (squared distance threshold) */
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;

  private static readonly MOVE_THRESHOLD_SQ = 0.25;

  private constructor(sourceIndices: Uint32Array, centroids: Float32Array, quadCount: number) {
    this.sourceIndices = sourceIndices;
    this.centroids = centroids;
    this.quadCount = quadCount;
  }

  /**
   * Create a WaterFaceSorter from a water geometry.
   * Pre-computes quad centroids from the position attribute.
   */
  static fromGeometry(geometry: THREE.BufferGeometry): WaterFaceSorter {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex()!;
    const indexArray = new Uint32Array(index.array as ArrayLike<number>);
    const quadCount = Math.floor(indexArray.length / 6);
    const centroids = new Float32Array(quadCount * 3);

    for (let q = 0; q < quadCount; q++) {
      const base = q * 6;
      // Average the 3 unique vertices of the first triangle as centroid
      const i0 = indexArray[base] * 3;
      const i1 = indexArray[base + 1] * 3;
      const i2 = indexArray[base + 2] * 3;
      centroids[q * 3] = (positions.array[i0] + positions.array[i1] + positions.array[i2]) / 3;
      centroids[q * 3 + 1] = (positions.array[i0 + 1] + positions.array[i1 + 1] + positions.array[i2 + 1]) / 3;
      centroids[q * 3 + 2] = (positions.array[i0 + 2] + positions.array[i1 + 2] + positions.array[i2 + 2]) / 3;
    }

    return new WaterFaceSorter(indexArray, centroids, quadCount);
  }

  /**
   * Sort water faces back-to-front relative to camera position (in chunk-local space).
   * Updates the geometry's index buffer in place.
   */
  sort(localCamPos: { x: number; y: number; z: number }, geometry: THREE.BufferGeometry): void {
    if (this.quadCount <= 1) return;

    // Check if camera moved enough to warrant re-sort
    const dx = localCamPos.x - this.lastCamX;
    const dy = localCamPos.y - this.lastCamY;
    const dz = localCamPos.z - this.lastCamZ;
    if (dx * dx + dy * dy + dz * dz < WaterFaceSorter.MOVE_THRESHOLD_SQ) return;

    this.lastCamX = localCamPos.x;
    this.lastCamY = localCamPos.y;
    this.lastCamZ = localCamPos.z;

    // Build array of [quadIndex, distanceSq] for sorting
    const order = new Array<number>(this.quadCount);
    const dists = new Float32Array(this.quadCount);
    for (let q = 0; q < this.quadCount; q++) {
      order[q] = q;
      const cx = this.centroids[q * 3] - localCamPos.x;
      const cy = this.centroids[q * 3 + 1] - localCamPos.y;
      const cz = this.centroids[q * 3 + 2] - localCamPos.z;
      dists[q] = cx * cx + cy * cy + cz * cz;
    }

    // Sort back-to-front (farthest first)
    order.sort((a, b) => dists[b] - dists[a]);

    // Write sorted indices into geometry
    const index = geometry.getIndex()!;
    const sorted = index.array as Uint32Array;
    for (let i = 0; i < this.quadCount; i++) {
      const srcBase = order[i] * 6;
      const dstBase = i * 6;
      sorted[dstBase] = this.sourceIndices[srcBase];
      sorted[dstBase + 1] = this.sourceIndices[srcBase + 1];
      sorted[dstBase + 2] = this.sourceIndices[srcBase + 2];
      sorted[dstBase + 3] = this.sourceIndices[srcBase + 3];
      sorted[dstBase + 4] = this.sourceIndices[srcBase + 4];
      sorted[dstBase + 5] = this.sourceIndices[srcBase + 5];
    }
    index.needsUpdate = true;
  }
}
