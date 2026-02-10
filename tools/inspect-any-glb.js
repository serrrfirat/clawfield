const fs = require('fs');
const path = process.argv[2];
if (!path) { console.log('Usage: node inspect-any-glb.js <file.glb>'); process.exit(1); }

const buf = fs.readFileSync(path);
const version = buf.readUInt32LE(4);
const totalLen = buf.readUInt32LE(8);
console.log('=== GLB Header ===');
console.log('Version:', version);
console.log('Total size:', (totalLen / 1024).toFixed(1) + ' KB');

const chunk0Len = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + chunk0Len));
const binOffset = 20 + chunk0Len;
const binLen = buf.readUInt32LE(binOffset);
console.log('JSON chunk:', (chunk0Len / 1024).toFixed(1) + ' KB');
console.log('Binary chunk:', (binLen / 1024).toFixed(1) + ' KB');

console.log('\n=== Asset Info ===');
console.log('Generator:', json.asset && json.asset.generator || 'unknown');

console.log('\n=== Meshes (' + (json.meshes ? json.meshes.length : 0) + ') ===');
let totalVerts = 0, totalTris = 0;
if (json.meshes) {
  for (const mesh of json.meshes) {
    console.log('  ' + (mesh.name || 'unnamed'));
    for (const prim of mesh.primitives || []) {
      const posAcc = json.accessors[prim.attributes.POSITION];
      totalVerts += posAcc.count;
      if (prim.indices !== undefined && prim.indices !== null) {
        const idxAcc = json.accessors[prim.indices];
        totalTris += idxAcc.count / 3;
        console.log('    verts:', posAcc.count, ' tris:', Math.floor(idxAcc.count / 3));
      } else {
        totalTris += posAcc.count / 3;
        console.log('    verts:', posAcc.count, ' (unindexed)');
      }
      console.log('    attributes:', Object.keys(prim.attributes).join(', '));
      if (prim.material !== undefined && prim.material !== null) {
        const mat = json.materials[prim.material];
        console.log('    material:', mat && mat.name || 'unnamed');
      }
    }
  }
}
console.log('\nTOTAL: ' + totalVerts + ' vertices, ' + Math.floor(totalTris) + ' triangles');

console.log('\n=== Materials (' + (json.materials ? json.materials.length : 0) + ') ===');
if (json.materials) {
  for (const mat of json.materials) {
    let info = '  ' + (mat.name || 'unnamed');
    const pbr = mat.pbrMetallicRoughness;
    if (pbr && pbr.baseColorTexture) info += ' [has texture]';
    if (pbr && pbr.baseColorFactor) info += ' color:' + JSON.stringify(pbr.baseColorFactor.map(function(v){return v.toFixed(2)}));
    if (mat.normalTexture) info += ' [normal map]';
    if (pbr && pbr.metallicRoughnessTexture) info += ' [metallic-roughness]';
    console.log(info);
  }
}

console.log('\n=== Textures (' + (json.textures ? json.textures.length : 0) + ') ===');
if (json.textures) {
  for (const tex of json.textures) {
    const img = json.images[tex.source];
    if (img.bufferView !== undefined) {
      const bv = json.bufferViews[img.bufferView];
      console.log('  ' + (img.mimeType || 'unknown') + ' (' + (bv.byteLength / 1024).toFixed(1) + ' KB)');
    } else if (img.uri) {
      console.log('  ' + img.uri);
    }
  }
}

console.log('\n=== Dimensions ===');
if (json.meshes) {
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives || []) {
      const posAcc = json.accessors[prim.attributes.POSITION];
      if (posAcc.min && posAcc.max) {
        const sx = (posAcc.max[0] - posAcc.min[0]).toFixed(3);
        const sy = (posAcc.max[1] - posAcc.min[1]).toFixed(3);
        const sz = (posAcc.max[2] - posAcc.min[2]).toFixed(3);
        console.log('  ' + (mesh.name || 'mesh') + ': ' + sx + ' x ' + sy + ' x ' + sz + ' units');
        console.log('    min: [' + posAcc.min.map(function(v){return v.toFixed(3)}).join(', ') + ']');
        console.log('    max: [' + posAcc.max.map(function(v){return v.toFixed(3)}).join(', ') + ']');
      }
    }
  }
}

console.log('\n=== Animations (' + (json.animations ? json.animations.length : 0) + ') ===');
if (json.animations) {
  for (const anim of json.animations) {
    console.log('  ' + (anim.name || 'unnamed') + ' (' + anim.channels.length + ' channels)');
  }
}

console.log('\n=== Skins/Rigs (' + (json.skins ? json.skins.length : 0) + ') ===');
if (json.skins) {
  for (const skin of json.skins) {
    console.log('  ' + (skin.name || 'unnamed') + ' (' + skin.joints.length + ' joints)');
  }
}

console.log('\n=== Scene Graph ===');
const scene = json.scenes[json.scene || 0];
function printNode(idx, depth) {
  if (depth > 3) return;
  const n = json.nodes[idx];
  let info = (n.name || 'node_' + idx);
  if (n.mesh !== undefined) info += ' [mesh]';
  if (n.skin !== undefined) info += ' [skinned]';
  if (n.scale) info += ' s:' + n.scale.map(function(v){return v.toFixed(2)}).join(',');
  if (n.translation) info += ' t:' + n.translation.map(function(v){return v.toFixed(2)}).join(',');
  console.log('  '.repeat(depth) + info);
  if (n.children) { for (const c of n.children) printNode(c, depth + 1); }
}
for (const r of scene.nodes) printNode(r, 0);
