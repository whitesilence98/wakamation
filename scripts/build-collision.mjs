import { readFile, writeFile } from "node:fs/promises";
import { Matrix4, Quaternion, Vector3 } from "three";

const CELL = 0.5, HALF = 45, N = 180;
// Floor elevation in the source asset; the scene lifts the map by -FLOOR_Y so
// gameplay always happens at y = 0. Emitted so the renderer cannot disagree.
const FLOOR_Y = -103.527;
const source = new URL("../client/public/models/map/map.cropped.glb", import.meta.url);
const bytes = await readFile(source);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error("Expected a glTF 2 GLB");
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
const bin = bytes.subarray(28 + jsonLength, 28 + jsonLength + bytes.readUInt32LE(20 + jsonLength));
function accessor(index) {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const components = { SCALAR: 1, VEC3: 3 }[a.type];
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  if (!components || !size || a.sparse || a.normalized || view.buffer !== 0) throw new Error("Unsupported collision accessor");
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? components * size;
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: components }, (_, c) => {
    const at = offset + i * stride + c * size;
    return a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5125 ? bin.readUInt32LE(at) : a.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt8(at);
  }));
}
const triangles = [];
function visit(index, parent) {
  const node = gltf.nodes[index];
  const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
  const world = parent.clone().multiply(local);
  if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error("Expected triangle primitives");
    const vertices = accessor(primitive.attributes.POSITION).map(position => {
      const v = new Vector3(...position).applyMatrix4(world);
      v.y -= FLOOR_Y;
      return [v.x, v.y, v.z];
    });
    const indices = primitive.indices === undefined ? vertices.map((_, i) => i) : accessor(primitive.indices).map(v => v[0]);
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = indices.slice(i, i + 3).map(index => vertices[index]);
      if (Math.max(...triangle.map(v => v[1])) < -2.5 || Math.min(...triangle.map(v => v[1])) > 4) continue;
      triangles.push(triangle);
    }
  }
  for (const child of node.children ?? []) visit(child, world);
}
for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new Matrix4());
const hits = Array.from({ length: N * N }, () => []);
const bounds = triangle => {
  const axis = component => [
    Math.max(0, Math.floor((Math.min(...triangle.map(v => v[component])) + HALF) / CELL)),
    Math.min(N - 1, Math.floor((Math.max(...triangle.map(v => v[component])) + HALF) / CELL)),
  ];
  return [...axis(0), ...axis(2)];
};
for (const triangle of triangles) {
  const [a, b, c] = triangle;
  const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denominator) < 1e-10) continue;
  const [x0, x1, z0, z1] = bounds(triangle);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const px = (x + 0.5) * CELL - HALF, pz = (z + 0.5) * CELL - HALF;
    const u = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / denominator;
    const v = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / denominator;
    if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
    const y = u * a[1] + v * b[1] + (1 - u - v) * c[1];
    if (y >= -2.5 && y <= 4) hits[z * N + x].push(y);
  }
}
const floors = hits.map(values => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : NaN);
const blocked = floors.map(y => !Number.isFinite(y) || Math.abs(y) > 0.8);
// Clip triangles to each cell, retaining height: thin/vertical walls must not vanish between centre samples.
function clip(polygon, axis, edge, direction) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const insideA = direction * (a[axis] - edge) >= 0, insideB = direction * (b[axis] - edge) >= 0;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      result.push(a.map((value, j) => value + (b[j] - value) * t));
    }
  }
  return result;
}
for (const triangle of triangles) {
  const [x0, x1, z0, z1] = bounds(triangle);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const index = z * N + x;
    if (blocked[index]) continue;
    const left = x * CELL - HALF, top = z * CELL - HALF;
    let polygon = clip(triangle, 0, left, 1);
    polygon = clip(polygon, 0, left + CELL, -1);
    polygon = clip(polygon, 2, top, 1);
    polygon = clip(polygon, 2, top + CELL, -1);
    if (polygon.length && Math.max(...polygon.map(v => v[1])) >= floors[index] + 0.3
      && Math.min(...polygon.map(v => v[1])) <= floors[index] + 1.35) blocked[index] = true;
  }
}
const original = blocked.slice();
for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
  const i = z * N + x;
  if (x === 0 || z === 0 || x === N - 1 || z === N - 1) blocked[i] = true;
  else if ([-1, 1, -N, N].some(delta => !original[i + delta] && Math.abs(floors[i] - floors[i + delta]) > 0.5)) blocked[i] = true;
}
const packed = Buffer.alloc(Math.ceil(N * N / 8));
blocked.forEach((value, i) => { if (value) packed[i >> 3] |= 1 << (i & 7); });
await writeFile(new URL("../shared/src/collision-data.ts", import.meta.url),
  `// Generated by scripts/build-collision.mjs; do not edit.\nexport const GRID_CELL = ${CELL};\nexport const GRID_HALF = ${HALF};\nexport const GRID_SIZE = ${N};\nexport const MAP_FLOOR_Y = ${FLOOR_Y};\nexport const COLLISION_BITS = "${packed.toString("base64")}";\n`);
console.log(`Collision data generated: ${blocked.filter(Boolean).length}/${N * N} blocked cells`);
