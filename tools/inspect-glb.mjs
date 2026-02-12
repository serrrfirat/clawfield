import fs from 'fs';

const buf = fs.readFileSync("/Users/firatsertgoz/Downloads/5 Buildings Low-Poly.glb");
const version = buf.readUInt32LE(4);
const length = buf.readUInt32LE(8);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));

console.log("GLB version:", version, "total size:", (length/1024/1024).toFixed(1) + "MB");
console.log("Scenes:", json.scenes?.length);
console.log("Nodes:", json.nodes?.length);
console.log("Meshes:", json.meshes?.length);
console.log("Materials:", json.materials?.length);
console.log("Textures:", json.textures?.length);
console.log("Images:", json.images?.length);
console.log();

function printNode(idx, depth = 0) {
  const n = json.nodes[idx];
  const prefix = "  ".repeat(depth);
  let meshInfo = "";
  if (n.mesh !== undefined) {
    const m = json.meshes[n.mesh];
    meshInfo = ` [mesh:${m.name || "?"} prims:${m.primitives.length}]`;
  }
  const pos = n.translation ? ` pos:(${n.translation.map(v => v.toFixed(1)).join(",")})` : "";
  const scl = n.scale ? ` scl:(${n.scale.map(v => v.toFixed(2)).join(",")})` : "";
  console.log(prefix + (n.name || "unnamed") + meshInfo + pos + scl);
  if (n.children) n.children.forEach(c => printNode(c, depth + 1));
}
json.scenes[0].nodes.forEach(n => printNode(n));

console.log();
console.log("Materials:");
(json.materials || []).forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness || {};
  const color = pbr.baseColorFactor
    ? pbr.baseColorFactor.map(v => v.toFixed(2)).join(",")
    : "textured";
  const hasTex = pbr.baseColorTexture ? " +texture" : "";
  console.log(`  ${i}: ${m.name || "unnamed"} color:(${color}) ${hasTex}`);
});

// Print mesh bounding info
console.log();
console.log("Mesh vertex counts:");
json.meshes?.forEach((m, i) => {
  let totalVerts = 0;
  m.primitives.forEach(p => {
    const posAccessor = json.accessors[p.attributes.POSITION];
    totalVerts += posAccessor.count;
  });
  console.log(`  ${i}: ${m.name || "?"} - ${totalVerts} vertices, ${m.primitives.length} primitives`);

  // Check bounding box
  const posAccessor = json.accessors[m.primitives[0].attributes.POSITION];
  if (posAccessor.min && posAccessor.max) {
    const size = posAccessor.max.map((v, j) => (v - posAccessor.min[j]).toFixed(1));
    console.log(`     bounds: ${size[0]} x ${size[1]} x ${size[2]}`);
  }
});
