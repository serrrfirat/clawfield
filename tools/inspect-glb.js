const fs = require('fs');
const buf = fs.readFileSync('apps/client/public/models/soldier.glb');
const chunk0Len = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + chunk0Len));

console.log('=== Materials ===');
for (const m of json.materials || []) {
  console.log(JSON.stringify(m, null, 2));
}

console.log('\n=== Node Tree ===');
const scene = json.scenes[json.scene || 0];
function printNode(idx, depth) {
  const n = json.nodes[idx];
  const pad = '  '.repeat(depth);
  let info = 'Node[' + idx + ']: ' + (n.name || '(unnamed)');
  if (n.mesh != null) info += ' mesh:' + n.mesh;
  if (n.skin != null) info += ' skin:' + n.skin;
  if (n.scale) info += ' scale:' + JSON.stringify(n.scale);
  if (n.translation) info += ' trans:' + JSON.stringify(n.translation);
  console.log(pad + info);
  for (const c of n.children || []) printNode(c, depth + 1);
}
for (const r of scene.nodes) printNode(r, 0);
