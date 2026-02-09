import * as THREE from 'three';
import { WeaponId, AttachmentId, AttachmentSlot } from '@clawfield/shared';
import type { WeaponLoadout } from '@clawfield/shared';
import { getWeaponModelGroup, hasWeaponModel } from './weapon-model-loader';

// ── Colour palette ─────────────────────────────────────────────────

const COL = {
  gunmetal: 0x3a3a3a,
  darkSteel: 0x2e2e2e,
  black: 0x1a1a1a,
  brown: 0x4a3525,
  darkBrown: 0x352518,
  tan: 0x6b5b3e,
  olive: 0x454b3a,
  rubber: 0x222222,
  chrome: 0x888888,
  sightRed: 0xff2200,
  sightGreen: 0x22ff44,
  scopeBody: 0x2a2a2a,
  magazineBlack: 0x1e1e1e,
} as const;

// ── Helper to build a box mesh ─────────────────────────────────────

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  segments = 8,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  // Rotate so cylinder lies along Z-axis (barrel direction)
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// ── Weapon model builder ───────────────────────────────────────────

interface WeaponModelParts {
  /** All meshes comprising the weapon */
  meshes: THREE.Mesh[];
  /** Attachment mount points (local positions relative to weapon group) */
  mountPoints: Partial<Record<AttachmentSlot, THREE.Vector3>>;
  /** Recoil characteristics */
  recoilScale: number;
  /** Recoil duration override */
  recoilDuration: number;
}

function buildAssaultRifle(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Receiver / main body
  meshes.push(box(0.12, 0.09, 0.38, COL.gunmetal, 0, 0, 0));
  // Barrel
  meshes.push(cylinder(0.018, 0.018, 0.32, COL.darkSteel, 0, 0.01, -0.34));
  // Barrel shroud / handguard
  meshes.push(box(0.08, 0.065, 0.22, COL.olive, 0, -0.005, -0.22));
  // Stock
  meshes.push(box(0.06, 0.07, 0.2, COL.darkBrown, 0, -0.005, 0.28));
  meshes.push(box(0.04, 0.05, 0.06, COL.rubber, 0, -0.005, 0.39));
  // Pistol grip
  meshes.push(box(0.04, 0.1, 0.04, COL.black, 0, -0.09, 0.08));
  // Magazine
  meshes.push(box(0.04, 0.12, 0.05, COL.magazineBlack, 0, -0.11, -0.02));
  // Charging handle
  meshes.push(box(0.03, 0.02, 0.04, COL.chrome, 0, 0.055, 0.04));
  // Top rail
  meshes.push(box(0.04, 0.015, 0.2, COL.darkSteel, 0, 0.052, -0.05));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.065, -0.06),
      barrel: new THREE.Vector3(0, 0.01, -0.52),
      grip: new THREE.Vector3(0, -0.05, -0.18),
      magazine: new THREE.Vector3(0, -0.11, -0.02),
    },
    recoilScale: 1.0,
    recoilDuration: 0.1,
  };
}

function buildSMG(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Compact receiver
  meshes.push(box(0.1, 0.08, 0.25, COL.gunmetal, 0, 0, 0));
  // Short barrel
  meshes.push(cylinder(0.015, 0.015, 0.18, COL.darkSteel, 0, 0.005, -0.2));
  // Barrel shroud (short)
  meshes.push(box(0.065, 0.055, 0.12, COL.darkSteel, 0, -0.005, -0.13));
  // Folding stock (wire-frame style — thin bars)
  meshes.push(box(0.02, 0.02, 0.14, COL.chrome, 0.03, -0.01, 0.18));
  meshes.push(box(0.02, 0.02, 0.14, COL.chrome, -0.03, -0.01, 0.18));
  meshes.push(box(0.08, 0.02, 0.02, COL.chrome, 0, -0.01, 0.25));
  // Pistol grip
  meshes.push(box(0.035, 0.08, 0.035, COL.black, 0, -0.07, 0.06));
  // Magazine (stick mag, slightly angled)
  const mag = box(0.03, 0.1, 0.04, COL.magazineBlack, 0, -0.1, -0.01);
  mag.rotation.x = 0.1;
  meshes.push(mag);
  // Top rail (short)
  meshes.push(box(0.035, 0.012, 0.12, COL.darkSteel, 0, 0.045, -0.02));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.055, -0.03),
      barrel: new THREE.Vector3(0, 0.005, -0.31),
      grip: new THREE.Vector3(0, -0.04, -0.1),
      magazine: new THREE.Vector3(0, -0.1, -0.01),
    },
    recoilScale: 0.7,
    recoilDuration: 0.07,
  };
}

function buildMedicSMG(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Slightly bulkier receiver than assault SMG
  meshes.push(box(0.11, 0.085, 0.28, COL.olive, 0, 0, 0));
  // Barrel
  meshes.push(cylinder(0.016, 0.016, 0.2, COL.darkSteel, 0, 0.005, -0.22));
  // Handguard
  meshes.push(box(0.07, 0.06, 0.14, COL.gunmetal, 0, -0.005, -0.14));
  // Solid stock
  meshes.push(box(0.05, 0.06, 0.16, COL.olive, 0, -0.005, 0.21));
  meshes.push(box(0.035, 0.045, 0.04, COL.rubber, 0, -0.005, 0.3));
  // Pistol grip
  meshes.push(box(0.035, 0.085, 0.035, COL.black, 0, -0.075, 0.07));
  // Magazine (wider for higher capacity)
  meshes.push(box(0.035, 0.1, 0.045, COL.magazineBlack, 0, -0.1, -0.01));
  // Top rail
  meshes.push(box(0.035, 0.012, 0.14, COL.darkSteel, 0, 0.048, -0.03));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.058, -0.04),
      barrel: new THREE.Vector3(0, 0.005, -0.34),
      grip: new THREE.Vector3(0, -0.04, -0.11),
      magazine: new THREE.Vector3(0, -0.1, -0.01),
    },
    recoilScale: 0.75,
    recoilDuration: 0.08,
  };
}

function buildShotgun(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Receiver (chunky)
  meshes.push(box(0.12, 0.1, 0.28, COL.gunmetal, 0, 0, 0));
  // Wide barrel
  meshes.push(cylinder(0.025, 0.025, 0.35, COL.darkSteel, 0, 0.015, -0.3));
  // Pump tube underneath
  meshes.push(cylinder(0.018, 0.018, 0.3, COL.darkSteel, 0, -0.03, -0.25));
  // Pump grip (slides on tube)
  meshes.push(box(0.06, 0.05, 0.08, COL.darkBrown, 0, -0.03, -0.22));
  // Wooden stock
  meshes.push(box(0.07, 0.08, 0.22, COL.brown, 0, -0.005, 0.24));
  meshes.push(box(0.06, 0.065, 0.04, COL.rubber, 0, -0.005, 0.36));
  // Pistol grip area (integrated into stock)
  meshes.push(box(0.045, 0.08, 0.04, COL.brown, 0, -0.06, 0.1));
  // Loading port on bottom
  meshes.push(box(0.06, 0.02, 0.1, COL.darkSteel, 0, -0.06, -0.03));
  // Top rail (short)
  meshes.push(box(0.035, 0.012, 0.1, COL.darkSteel, 0, 0.055, 0));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.068, -0.02),
      barrel: new THREE.Vector3(0, 0.015, -0.5),
      magazine: new THREE.Vector3(0, -0.06, -0.03),
    },
    recoilScale: 1.6,
    recoilDuration: 0.18,
  };
}

function buildCarbine(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Compact receiver
  meshes.push(box(0.11, 0.085, 0.32, COL.darkSteel, 0, 0, 0));
  // Medium barrel
  meshes.push(cylinder(0.017, 0.017, 0.26, COL.gunmetal, 0, 0.008, -0.28));
  // Handguard with rail
  meshes.push(box(0.075, 0.06, 0.18, COL.tan, 0, -0.003, -0.18));
  // Adjustable stock (two-position)
  meshes.push(box(0.04, 0.04, 0.15, COL.gunmetal, 0, 0, 0.22));
  meshes.push(box(0.055, 0.06, 0.06, COL.rubber, 0, -0.005, 0.31));
  // Pistol grip
  meshes.push(box(0.038, 0.09, 0.038, COL.black, 0, -0.08, 0.07));
  // Magazine
  meshes.push(box(0.035, 0.1, 0.04, COL.magazineBlack, 0, -0.1, -0.02));
  // Top rail (full-length)
  meshes.push(box(0.04, 0.014, 0.26, COL.gunmetal, 0, 0.049, -0.08));
  // Charging handle
  meshes.push(box(0.025, 0.018, 0.03, COL.chrome, 0, 0.05, 0.06));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.062, -0.08),
      barrel: new THREE.Vector3(0, 0.008, -0.44),
      grip: new THREE.Vector3(0, -0.04, -0.15),
      magazine: new THREE.Vector3(0, -0.1, -0.02),
    },
    recoilScale: 0.95,
    recoilDuration: 0.1,
  };
}

function buildPDW(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Bullpup-style compact body — magazine behind grip
  meshes.push(box(0.1, 0.08, 0.32, COL.gunmetal, 0, 0, 0));
  // Short barrel
  meshes.push(cylinder(0.014, 0.014, 0.15, COL.darkSteel, 0, 0.005, -0.22));
  // Shroud
  meshes.push(box(0.06, 0.05, 0.1, COL.darkSteel, 0, -0.005, -0.16));
  // Integral top rail (P90 style)
  meshes.push(box(0.06, 0.015, 0.24, COL.gunmetal, 0, 0.045, -0.02));
  // Pistol grip (forward position)
  meshes.push(box(0.035, 0.08, 0.035, COL.rubber, 0, -0.07, -0.04));
  // Magazine on top (P90 style — horizontal mag)
  meshes.push(box(0.06, 0.025, 0.16, COL.magazineBlack, 0, 0.06, 0.04));
  // Compact stock (integrated)
  meshes.push(box(0.06, 0.05, 0.06, COL.rubber, 0, -0.01, 0.18));
  // Trigger guard
  meshes.push(box(0.04, 0.01, 0.06, COL.gunmetal, 0, -0.04, -0.04));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.075, -0.04),
      barrel: new THREE.Vector3(0, 0.005, -0.32),
      grip: new THREE.Vector3(0, -0.04, -0.12),
      magazine: new THREE.Vector3(0, 0.06, 0.04),
    },
    recoilScale: 0.6,
    recoilDuration: 0.06,
  };
}

function buildSniperRifle(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Long receiver
  meshes.push(box(0.12, 0.09, 0.42, COL.darkSteel, 0, 0, 0));
  // Long heavy barrel
  meshes.push(cylinder(0.022, 0.018, 0.45, COL.gunmetal, 0, 0.012, -0.42));
  // Barrel shroud
  meshes.push(box(0.06, 0.05, 0.12, COL.darkSteel, 0, 0.005, -0.24));
  // Full wooden stock
  meshes.push(box(0.07, 0.08, 0.26, COL.brown, 0, -0.005, 0.33));
  meshes.push(box(0.06, 0.06, 0.04, COL.rubber, 0, -0.005, 0.47));
  // Cheek rest (raised)
  meshes.push(box(0.04, 0.025, 0.1, COL.brown, 0, 0.05, 0.28));
  // Pistol grip
  meshes.push(box(0.04, 0.1, 0.04, COL.black, 0, -0.09, 0.1));
  // Bolt handle
  meshes.push(box(0.04, 0.015, 0.03, COL.chrome, 0.06, 0.02, 0.02));
  // Magazine (short)
  meshes.push(box(0.035, 0.08, 0.04, COL.magazineBlack, 0, -0.09, -0.02));
  // Scope rail
  meshes.push(box(0.04, 0.015, 0.28, COL.darkSteel, 0, 0.052, -0.04));
  // Bipod legs (folded back)
  meshes.push(box(0.01, 0.06, 0.02, COL.chrome, 0.03, -0.06, -0.2));
  meshes.push(box(0.01, 0.06, 0.02, COL.chrome, -0.03, -0.06, -0.2));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.065, -0.04),
      barrel: new THREE.Vector3(0, 0.012, -0.68),
      magazine: new THREE.Vector3(0, -0.09, -0.02),
    },
    recoilScale: 1.8,
    recoilDuration: 0.2,
  };
}

function buildDMR(): WeaponModelParts {
  const meshes: THREE.Mesh[] = [];
  // Receiver (slightly longer than AR)
  meshes.push(box(0.12, 0.088, 0.36, COL.darkSteel, 0, 0, 0));
  // Longer barrel than AR
  meshes.push(cylinder(0.019, 0.019, 0.35, COL.gunmetal, 0, 0.01, -0.34));
  // Free-float handguard
  meshes.push(box(0.075, 0.06, 0.2, COL.gunmetal, 0, -0.003, -0.2));
  // Adjustable stock
  meshes.push(box(0.05, 0.06, 0.18, COL.darkSteel, 0, -0.005, 0.26));
  meshes.push(box(0.045, 0.055, 0.04, COL.rubber, 0, -0.005, 0.36));
  // Cheek riser
  meshes.push(box(0.035, 0.02, 0.06, COL.rubber, 0, 0.04, 0.24));
  // Pistol grip (ergonomic)
  meshes.push(box(0.04, 0.1, 0.04, COL.black, 0, -0.09, 0.08));
  // Magazine (medium)
  meshes.push(box(0.035, 0.09, 0.04, COL.magazineBlack, 0, -0.1, -0.02));
  // Top rail (full-length)
  meshes.push(box(0.04, 0.015, 0.3, COL.darkSteel, 0, 0.052, -0.06));
  // Bipod attachment point
  meshes.push(box(0.02, 0.015, 0.03, COL.chrome, 0, -0.04, -0.28));

  return {
    meshes,
    mountPoints: {
      sight: new THREE.Vector3(0, 0.065, -0.06),
      barrel: new THREE.Vector3(0, 0.01, -0.54),
      grip: new THREE.Vector3(0, -0.04, -0.16),
      magazine: new THREE.Vector3(0, -0.1, -0.02),
    },
    recoilScale: 1.3,
    recoilDuration: 0.14,
  };
}

// ── Weapon model factory ───────────────────────────────────────────

const MODEL_BUILDERS: Record<WeaponId, () => WeaponModelParts> = {
  [WeaponId.AssaultRifle]: buildAssaultRifle,
  [WeaponId.SMG_Assault]: buildSMG,
  [WeaponId.SMG_Medic]: buildMedicSMG,
  [WeaponId.Shotgun]: buildShotgun,
  [WeaponId.Carbine]: buildCarbine,
  [WeaponId.PDW]: buildPDW,
  [WeaponId.SniperRifle]: buildSniperRifle,
  [WeaponId.DMR]: buildDMR,
};

// ── Attachment model builders ──────────────────────────────────────

function buildRedDot(): THREE.Group {
  const g = new THREE.Group();
  // Mount base
  g.add(box(0.025, 0.015, 0.03, COL.darkSteel, 0, 0, 0));
  // Housing
  g.add(box(0.022, 0.025, 0.04, COL.black, 0, 0.02, 0));
  // Lens (front & rear openings)
  g.add(box(0.018, 0.018, 0.002, COL.sightRed, 0, 0.022, -0.018));
  return g;
}

function buildHolographic(): THREE.Group {
  const g = new THREE.Group();
  // Wide rectangular housing
  g.add(box(0.035, 0.028, 0.045, COL.black, 0, 0.018, 0));
  // Hood (top protection)
  g.add(box(0.038, 0.005, 0.048, COL.darkSteel, 0, 0.035, 0));
  // Reticle window
  g.add(box(0.028, 0.02, 0.002, COL.sightGreen, 0, 0.02, -0.022));
  return g;
}

function buildAcog(): THREE.Group {
  const g = new THREE.Group();
  // Scope tube
  const tube = cylinder(0.015, 0.015, 0.08, COL.scopeBody, 0, 0.02, 0);
  g.add(tube);
  // Objective lens (front, slightly larger)
  const lens = cylinder(0.018, 0.018, 0.005, COL.darkSteel, 0, 0.02, -0.04);
  g.add(lens);
  // Mount
  g.add(box(0.025, 0.012, 0.04, COL.darkSteel, 0, 0.005, 0));
  // Fiber optic strip on top
  g.add(box(0.004, 0.004, 0.05, COL.sightRed, 0, 0.036, 0));
  return g;
}

function buildScope8x(): THREE.Group {
  const g = new THREE.Group();
  // Long scope tube
  const tube = cylinder(0.018, 0.018, 0.14, COL.scopeBody, 0, 0.025, -0.01);
  g.add(tube);
  // Objective bell (wider front)
  const bell = cylinder(0.024, 0.018, 0.03, COL.scopeBody, 0, 0.025, -0.08);
  g.add(bell);
  // Ocular bell (rear)
  const ocular = cylinder(0.02, 0.018, 0.02, COL.scopeBody, 0, 0.025, 0.06);
  g.add(ocular);
  // Turret knobs
  g.add(box(0.01, 0.015, 0.01, COL.chrome, 0, 0.042, 0));
  g.add(box(0.015, 0.01, 0.01, COL.chrome, 0.025, 0.025, 0));
  // Scope rings (mounts)
  g.add(box(0.035, 0.015, 0.015, COL.darkSteel, 0, 0.01, -0.03));
  g.add(box(0.035, 0.015, 0.015, COL.darkSteel, 0, 0.01, 0.03));
  return g;
}

function buildSuppressor(): THREE.Group {
  const g = new THREE.Group();
  // Long cylindrical suppressor body
  const body = cylinder(0.022, 0.022, 0.12, COL.darkSteel, 0, 0, 0);
  g.add(body);
  // End cap detail
  const cap = cylinder(0.024, 0.024, 0.008, COL.black, 0, 0, -0.06);
  g.add(cap);
  return g;
}

function buildCompensator(): THREE.Group {
  const g = new THREE.Group();
  // Short muzzle device with ports
  g.add(box(0.03, 0.03, 0.04, COL.darkSteel, 0, 0, 0));
  // Port cuts (lighter colored slots)
  g.add(box(0.032, 0.008, 0.01, COL.chrome, 0, 0.012, -0.008));
  g.add(box(0.032, 0.008, 0.01, COL.chrome, 0, 0.012, 0.008));
  return g;
}

function buildFlashHider(): THREE.Group {
  const g = new THREE.Group();
  // Prong-style flash hider
  const body = cylinder(0.016, 0.02, 0.04, COL.darkSteel, 0, 0, 0);
  g.add(body);
  return g;
}

function buildHeavyBarrelAttachment(): THREE.Group {
  const g = new THREE.Group();
  // Thick barrel extension
  const body = cylinder(0.024, 0.02, 0.06, COL.gunmetal, 0, 0, 0);
  g.add(body);
  // Fluted detail
  g.add(box(0.005, 0.028, 0.05, COL.darkSteel, 0.02, 0, 0));
  g.add(box(0.005, 0.028, 0.05, COL.darkSteel, -0.02, 0, 0));
  return g;
}

function buildVerticalGrip(): THREE.Group {
  const g = new THREE.Group();
  // Vertical grip body
  g.add(box(0.025, 0.06, 0.025, COL.black, 0, -0.03, 0));
  // Rounded bottom
  g.add(box(0.028, 0.01, 0.028, COL.rubber, 0, -0.06, 0));
  return g;
}

function buildAngledGrip(): THREE.Group {
  const g = new THREE.Group();
  // Angled grip — wedge shape
  const grip = box(0.025, 0.04, 0.04, COL.black, 0, -0.02, 0);
  grip.rotation.x = -0.5;
  g.add(grip);
  return g;
}

function buildStubbyGrip(): THREE.Group {
  const g = new THREE.Group();
  // Short stubby grip
  g.add(box(0.03, 0.03, 0.03, COL.rubber, 0, -0.018, 0));
  g.add(box(0.028, 0.01, 0.028, COL.black, 0, 0, 0));
  return g;
}

function buildExtendedMag(): THREE.Group {
  const g = new THREE.Group();
  // Taller magazine extension plate
  g.add(box(0.04, 0.03, 0.05, COL.magazineBlack, 0, -0.04, 0));
  return g;
}

function buildQuickDrawMag(): THREE.Group {
  const g = new THREE.Group();
  // Mag pull tab on bottom
  g.add(box(0.02, 0.015, 0.04, COL.rubber, 0, -0.02, 0));
  // Speed loop
  g.add(box(0.025, 0.025, 0.005, COL.olive, 0, -0.03, -0.02));
  return g;
}

// ── Attachment ID → model builder ──────────────────────────────────

const ATTACHMENT_BUILDERS: Record<AttachmentId, () => THREE.Group> = {
  [AttachmentId.RedDot]: buildRedDot,
  [AttachmentId.Holographic]: buildHolographic,
  [AttachmentId.Acog4x]: buildAcog,
  [AttachmentId.Scope8x]: buildScope8x,
  [AttachmentId.Suppressor]: buildSuppressor,
  [AttachmentId.Compensator]: buildCompensator,
  [AttachmentId.FlashHider]: buildFlashHider,
  [AttachmentId.HeavyBarrel]: buildHeavyBarrelAttachment,
  [AttachmentId.VerticalGrip]: buildVerticalGrip,
  [AttachmentId.AngledGrip]: buildAngledGrip,
  [AttachmentId.StubbyGrip]: buildStubbyGrip,
  [AttachmentId.ExtendedMag]: buildExtendedMag,
  [AttachmentId.QuickDrawMag]: buildQuickDrawMag,
};

const SLOT_FOR_ATTACHMENT: Record<AttachmentId, AttachmentSlot> = {
  [AttachmentId.RedDot]: 'sight' as AttachmentSlot,
  [AttachmentId.Holographic]: 'sight' as AttachmentSlot,
  [AttachmentId.Acog4x]: 'sight' as AttachmentSlot,
  [AttachmentId.Scope8x]: 'sight' as AttachmentSlot,
  [AttachmentId.Suppressor]: 'barrel' as AttachmentSlot,
  [AttachmentId.Compensator]: 'barrel' as AttachmentSlot,
  [AttachmentId.FlashHider]: 'barrel' as AttachmentSlot,
  [AttachmentId.HeavyBarrel]: 'barrel' as AttachmentSlot,
  [AttachmentId.VerticalGrip]: 'grip' as AttachmentSlot,
  [AttachmentId.AngledGrip]: 'grip' as AttachmentSlot,
  [AttachmentId.StubbyGrip]: 'grip' as AttachmentSlot,
  [AttachmentId.ExtendedMag]: 'magazine' as AttachmentSlot,
  [AttachmentId.QuickDrawMag]: 'magazine' as AttachmentSlot,
};

// ── Viewmodel class ────────────────────────────────────────────────

/**
 * First-person weapon viewmodel.
 * Renders a detailed weapon model attached to the camera
 * with per-weapon unique geometry and attachment mount points.
 */
export class Viewmodel {
  readonly group: THREE.Group;

  /** Rest position relative to camera — centered like BattleBit */
  private readonly restPosition = new THREE.Vector3(0.15, -0.22, -0.45);

  /** Recoil state */
  private recoilTime = 0;
  private recoilDuration = 0.1;
  private recoilScale = 1.0;
  private inRecoil = false;

  /** Accumulated visual recoil for sustained fire (smoothed separately) */
  private visualRecoilPitch = 0;
  private visualRecoilYaw = 0;

  /** Shot counter for alternating visual recoil direction */
  private shotCount = 0;

  /** Current weapon meshes (for cleanup) */
  private weaponGroup: THREE.Group;
  /** Current attachment groups (for cleanup) */
  private attachmentGroups: Map<AttachmentSlot, THREE.Group> = new Map();
  /** Mount points for the current weapon */
  private mountPoints: Partial<Record<AttachmentSlot, THREE.Vector3>> = {};

  /** Current weapon ID */
  private currentWeaponId: WeaponId = WeaponId.AssaultRifle;

  /** Idle sway phase (always ticking) */
  private swayTime = 0;

  /** Walk bob phase and state */
  private bobTime = 0;
  private isMoving = false;
  private isSprinting = false;

  /** Smoothed bob offset for interpolation */
  private smoothBobX = 0;
  private smoothBobY = 0;

  /** Hands group (procedural forearms/hands) */
  private handsGroup: THREE.Group;

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();
    this.weaponGroup = new THREE.Group();
    this.handsGroup = new THREE.Group();
    this.group.add(this.weaponGroup);
    this.group.add(this.handsGroup);

    // Position at bottom-right of view
    this.group.position.copy(this.restPosition);

    // Build procedural hands
    this.buildHands();

    // Attach to camera
    camera.add(this.group);

    // Build default weapon
    this.buildWeapon(WeaponId.AssaultRifle);
  }

  /** Build procedural arms + hands that extend from body to weapon grip */
  private buildHands(): void {
    // Clear existing
    while (this.handsGroup.children.length > 0) {
      const child = this.handsGroup.children[0];
      this.handsGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const skinColor = 0xc8956c;
    const sleeveColor = 0x3a4a35; // olive drab
    const skinMat = new THREE.MeshLambertMaterial({ color: skinColor });
    const sleeveMat = new THREE.MeshLambertMaterial({ color: sleeveColor });

    // ── Right arm (trigger hand) — extends from lower-right toward grip ──
    // Upper arm (goes off-screen toward body)
    const rUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), sleeveMat);
    rUpperArm.position.set(0.06, -0.22, 0.15);
    rUpperArm.rotation.z = -0.2;
    rUpperArm.rotation.x = 0.3;
    this.handsGroup.add(rUpperArm);

    // Forearm
    const rForearm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.055), sleeveMat.clone());
    rForearm.position.set(0.04, -0.10, 0.06);
    rForearm.rotation.x = 0.6;
    this.handsGroup.add(rForearm);

    // Right hand/fist wrapping the pistol grip
    const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.07), skinMat);
    rHand.position.set(0.03, -0.06, 0.01);
    this.handsGroup.add(rHand);

    // Trigger finger
    const rFinger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.04), skinMat.clone());
    rFinger.position.set(0.01, -0.045, -0.02);
    this.handsGroup.add(rFinger);

    // ── Left arm (forend/pump grip) — extends from lower-left toward forend ──
    // Upper arm
    const lUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), sleeveMat.clone());
    lUpperArm.position.set(-0.06, -0.22, -0.05);
    lUpperArm.rotation.z = 0.3;
    lUpperArm.rotation.x = 0.2;
    this.handsGroup.add(lUpperArm);

    // Forearm — reaching forward to forend
    const lForearm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.055), sleeveMat.clone());
    lForearm.position.set(-0.04, -0.10, -0.14);
    lForearm.rotation.x = 0.5;
    lForearm.rotation.z = 0.15;
    this.handsGroup.add(lForearm);

    // Left hand wrapping the forend
    const lHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.07), skinMat.clone());
    lHand.position.set(-0.02, -0.055, -0.2);
    this.handsGroup.add(lHand);
  }

  /** Update movement state for bob/sway animation */
  setMovementState(moving: boolean, sprinting: boolean): void {
    this.isMoving = moving;
    this.isSprinting = sprinting;
  }

  /** Build the 3D model for a given weapon */
  private buildWeapon(weaponId: WeaponId): void {
    // Clear existing weapon meshes
    this.clearWeaponGroup();
    this.clearAttachments();

    this.currentWeaponId = weaponId;

    // Try loaded GLB model first, fall back to procedural
    if (hasWeaponModel(weaponId)) {
      const glbGroup = getWeaponModelGroup(weaponId);
      if (glbGroup) {
        this.weaponGroup.add(glbGroup);
        console.log(`[Viewmodel] Using GLB model for ${weaponId}`);
        // Use procedural builder just for mount points and recoil config
        const parts = MODEL_BUILDERS[weaponId]();
        this.mountPoints = parts.mountPoints;
        this.recoilScale = parts.recoilScale;
        this.recoilDuration = parts.recoilDuration;
        return;
      }
    }

    const builder = MODEL_BUILDERS[weaponId];
    const parts = builder();

    for (const mesh of parts.meshes) {
      this.weaponGroup.add(mesh);
    }

    this.mountPoints = parts.mountPoints;
    this.recoilScale = parts.recoilScale;
    this.recoilDuration = parts.recoilDuration;
  }

  /** Clear weapon group meshes */
  private clearWeaponGroup(): void {
    while (this.weaponGroup.children.length > 0) {
      const child = this.weaponGroup.children[0];
      this.weaponGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  /** Clear all attachment groups */
  private clearAttachments(): void {
    for (const [, group] of this.attachmentGroups) {
      this.disposeGroup(group);
      this.weaponGroup.remove(group);
    }
    this.attachmentGroups.clear();
  }

  /** Recursively dispose a THREE.Group */
  private disposeGroup(group: THREE.Group): void {
    for (const child of group.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Group) {
        this.disposeGroup(child);
      }
    }
  }

  /** Trigger recoil animation on fire */
  onFire(): void {
    this.inRecoil = true;
    this.recoilTime = 0;
    this.shotCount++;

    // Add visual recoil impulse (alternating yaw for weapon character)
    this.visualRecoilPitch -= 0.03 * this.recoilScale;
    this.visualRecoilYaw += (this.shotCount % 2 === 0 ? 1 : -1) * 0.01 * this.recoilScale;
  }

  /**
   * Animate recoil, idle sway, and walk bob each frame.
   *
   * BattleBit-style: sharp snap back with asymmetric timing.
   * Idle sway: gentle figure-8 breathing motion.
   * Walk bob: rhythmic side-to-side and up-down bounce.
   */
  update(dt: number): void {
    // ── Idle sway (always ticking) ──
    this.swayTime += dt;
    // Figure-8 breathing pattern using Lissajous curves
    const idleSwayX = Math.sin(this.swayTime * 1.2) * 0.003;
    const idleSwayY = Math.sin(this.swayTime * 0.8) * 0.002;
    const idleRotX = Math.sin(this.swayTime * 0.9) * 0.004;
    const idleRotY = Math.sin(this.swayTime * 1.1) * 0.003;

    // ── Walk bob ──
    if (this.isMoving) {
      const bobSpeed = this.isSprinting ? 14 : 9;
      this.bobTime += dt * bobSpeed;
    }
    // Smooth bob targets (decays when stopped)
    const bobIntensity = this.isMoving ? (this.isSprinting ? 1.4 : 1.0) : 0;
    const targetBobX = Math.sin(this.bobTime) * 0.012 * bobIntensity;
    const targetBobY = Math.abs(Math.sin(this.bobTime * 2)) * 0.008 * bobIntensity;
    // Smooth interpolation for natural start/stop
    const bobLerp = this.isMoving ? 8 : 5;
    this.smoothBobX += (targetBobX - this.smoothBobX) * Math.min(1, bobLerp * dt);
    this.smoothBobY += (targetBobY - this.smoothBobY) * Math.min(1, bobLerp * dt);

    // Walk bob rotation (slight tilt as you step)
    const bobRotZ = this.smoothBobX * 0.8;  // roll with bob
    const bobRotX = this.smoothBobY * 0.3;  // slight pitch with bounce

    // Decay visual recoil smoothly (always runs, even when not in recoil animation)
    const recoverySpeed = 8;
    this.visualRecoilPitch += (0 - this.visualRecoilPitch) * Math.min(1, recoverySpeed * dt);
    this.visualRecoilYaw += (0 - this.visualRecoilYaw) * Math.min(1, recoverySpeed * dt);

    if (!this.inRecoil) {
      // Combine idle sway + walk bob + visual recoil drift
      this.group.position.set(
        this.restPosition.x + idleSwayX + this.smoothBobX + this.visualRecoilYaw * 0.3,
        this.restPosition.y + idleSwayY + this.smoothBobY,
        this.restPosition.z,
      );
      this.group.rotation.set(
        this.visualRecoilPitch + idleRotX + bobRotX,
        this.visualRecoilYaw + idleRotY,
        bobRotZ,
      );
      return;
    }

    this.recoilTime += dt;
    const t = Math.min(this.recoilTime / this.recoilDuration, 1);

    // Asymmetric kick curve: fast snap (0-0.3), slow return (0.3-1.0)
    let kickAmount: number;
    if (t < 0.3) {
      const tSnap = t / 0.3;
      kickAmount = 1 - Math.pow(1 - tSnap, 2);
    } else {
      const tReturn = (t - 0.3) / 0.7;
      kickAmount = 1 - tReturn * tReturn;
    }

    const kick = kickAmount * this.recoilScale;

    // Position kick + sway + bob
    const sideKick = Math.sin(this.shotCount * 2.1) * kick * 0.008;
    this.group.position.set(
      this.restPosition.x + sideKick + idleSwayX + this.smoothBobX + this.visualRecoilYaw * 0.3,
      this.restPosition.y + kick * 0.025 + idleSwayY + this.smoothBobY,
      this.restPosition.z + kick * 0.12,
    );

    // Rotation kick + sway + bob
    const rollKick = Math.sin(this.shotCount * 1.7) * kick * 0.015;
    this.group.rotation.set(
      -kick * 0.1 + this.visualRecoilPitch + idleRotX + bobRotX,
      this.visualRecoilYaw + idleRotY,
      rollKick + bobRotZ,
    );

    if (t >= 1) {
      this.inRecoil = false;
    }
  }

  /** Switch to a different weapon model */
  setWeaponType(weaponId: WeaponId): void {
    if (weaponId === this.currentWeaponId) return;
    this.buildWeapon(weaponId);
  }

  /** Apply a loadout of attachments to the current weapon model */
  setAttachments(loadout: WeaponLoadout): void {
    // Remove existing attachment models
    this.clearAttachments();

    const slots = Object.keys(loadout) as AttachmentSlot[];
    for (const slot of slots) {
      const attachId = loadout[slot];
      if (!attachId) continue;

      const builder = ATTACHMENT_BUILDERS[attachId];
      if (!builder) continue;

      const attachGroup = builder();

      // Position at the weapon's mount point for this slot
      const mountSlot = SLOT_FOR_ATTACHMENT[attachId] ?? slot;
      const mountPoint = this.mountPoints[mountSlot];
      if (mountPoint) {
        attachGroup.position.copy(mountPoint);
      }

      this.weaponGroup.add(attachGroup);
      this.attachmentGroups.set(slot, attachGroup);
    }
  }

  /** Show or hide the viewmodel (hidden when scoped) */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Get the current weapon's recoil scale */
  getRecoilScale(): number {
    return this.recoilScale;
  }

  /** Clean up */
  dispose(): void {
    this.clearAttachments();
    this.clearWeaponGroup();
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
