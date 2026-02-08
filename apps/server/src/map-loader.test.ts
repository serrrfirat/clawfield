import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getConfiguredMapName,
  parseMapMetadata,
  type MapMetadata,
} from './map-loader.js';

describe('map-loader map selection', () => {
  it('defaults to shoreline when CLAWFIELD_MAP is not set', () => {
    const prev = process.env.CLAWFIELD_MAP;
    delete process.env.CLAWFIELD_MAP;

    try {
      assert.equal(getConfiguredMapName(), 'shoreline');
    } finally {
      process.env.CLAWFIELD_MAP = prev;
    }
  });

  it('uses normalized CLAWFIELD_MAP value when set', () => {
    const prev = process.env.CLAWFIELD_MAP;
    process.env.CLAWFIELD_MAP = '  SHORELINE  ';

    try {
      assert.equal(getConfiguredMapName(), 'shoreline');
    } finally {
      process.env.CLAWFIELD_MAP = prev;
    }
  });
});

describe('parseMapMetadata', () => {
  it('parses spawn points and capture points from PRD-style JSON', () => {
    const raw = {
      name: 'Shoreline',
      spawn_points: {
        alpha: [
          { x: -90, y: 3, z: -20 },
          { x: -88, y: 3, z: 8 },
        ],
        bravo: [
          { x: 88, y: 8, z: 10 },
          { x: 90, y: 8, z: -18 },
        ],
      },
      capture_points: [
        { id: 'A', position: { x: -40, y: 3, z: 0 }, initialOwner: 0 },
        { id: 'B', position: { x: 0, y: 3, z: 0 }, initialOwner: -1 },
        { id: 'C', position: { x: 45, y: 8, z: 20 }, initialOwner: 1 },
      ],
    };

    const parsed = parseMapMetadata(raw) as MapMetadata;

    assert.equal(parsed.name, 'Shoreline');
    assert.equal(parsed.spawnPoints.alpha.length, 2);
    assert.equal(parsed.spawnPoints.bravo.length, 2);
    assert.equal(parsed.capturePoints.length, 3);
    assert.deepEqual(parsed.capturePoints[1], {
      id: 'B',
      position: { x: 0, y: 3, z: 0 },
      initialOwner: -1,
    });
    assert.equal(parsed.objectives.length, 0);
  });

  it('parses objectives from metadata', () => {
    const raw = {
      name: 'Shoreline',
      spawn_points: {
        alpha: [{ x: -90, y: 3, z: -20 }],
        bravo: [{ x: 88, y: 8, z: 10 }],
      },
      objectives: [
        { id: 'harbor', type: 'control', position: { x: -48, y: 3, z: 0 } },
        { id: 'bridge', type: 'chokepoint', position: { x: 50, y: 8, z: 60 } },
      ],
    };

    const parsed = parseMapMetadata(raw) as MapMetadata;
    assert.equal(parsed.objectives.length, 2);
    assert.deepEqual(parsed.objectives[0], {
      id: 'harbor',
      type: 'control',
      position: { x: -48, y: 3, z: 0 },
    });
  });

  it('returns null for invalid metadata payload', () => {
    const parsed = parseMapMetadata({
      name: 'Broken',
      spawn_points: { alpha: 'bad', bravo: [] },
    });

    assert.equal(parsed, null);
  });

  it('returns null for invalid objective entry', () => {
    const parsed = parseMapMetadata({
      name: 'BrokenObjectives',
      spawn_points: {
        alpha: [{ x: 0, y: 0, z: 0 }],
        bravo: [{ x: 1, y: 0, z: 0 }],
      },
      objectives: [{ id: 'bad', type: 123, position: { x: 0, y: 0, z: 0 } }],
    });

    assert.equal(parsed, null);
  });
});
