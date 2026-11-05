import { readFile, writeFile } from "node:fs/promises";
import { Matrix4, Quaternion, Vector3, Box3 } from "three";

// Crop the map to the play area. Everything outside the box is removed, then
// unused images/textures/materials/accessors are pruned so the bytes actually go.
const CENTER = [0, -10];  // x, z of the play area
const HALF = 100;         // half-extent, covers the 85-unit fog distance + margin
const ALWAYS_KEEP = 150;  // wider than this = floor / room shell: never crop
const source = new URL("../client/public/models/map/map.glb", import.meta.url);
const target = new URL("../client/public/models/map/map.cropped.glb", import.meta.url);

const bytes = await readFile(source);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error("Expected a glTF 2 GLB");
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
if (gltf.buffers.length !== 1 || gltf.buffers[0].uri !== undefined) throw new Error("Expected one embedded buffer");
const bin = bytes.subarray(28 + jsonLength, 28 + jsonLength + bytes.readUInt32LE(20 + jsonLength));

const localMatrix = node => node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
  new Vector3(...(node.translation ?? [0, 0, 0])),
  new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
  new Vector3(...(node.scale ?? [1, 1, 1])),
);

const boxOf = (accessorIndex, world) => {
  const a = gltf.accessors[accessorIndex];
  return new Box3(new Vector3(...a.min), new Vector3(...a.max)).applyMatrix4(world);
};

// Keep a mesh when any primitive's world box overlaps the play area, or when the
// primitive is so wide it must be structure (floor, room shell).
const inPlayArea = (meshIndex, world) => gltf.meshes[meshIndex].primitives.some(primitive => {
  const box = boxOf(primitive.attributes.POSITION, world);
  const size = box.getSize(new Vector3());
  if (size.x > ALWAYS_KEEP || size.z > ALWAYS_KEEP) return true;
  return box.max.x >= CENTER[0] - HALF && box.min.x <= CENTER[0] + HALF
    && box.max.z >= CENTER[1] - HALF && box.min.z <= CENTER[1] + HALF;
});

// A node survives when it draws inside the area or when a surviving child needs it.
const keep = new Array(gltf.nodes.length).fill(false);
const visit = (index, parent) => {
  const world = parent.clone().multiply(localMatrix(gltf.nodes[index]));
  const node = gltf.nodes[index];
  if (node.mesh !== undefined && inPlayArea(node.mesh, world)) keep[index] = true;
  for (const child of node.children ?? []) if (visit(child, world)) keep[index] = true;
  return keep[index];
};
const scene = gltf.scenes[gltf.scene ?? 0];
for (const root of scene.nodes) visit(root, new Matrix4());
scene.nodes = scene.nodes.filter(index => keep[index]);
if (!scene.nodes.length) throw new Error("Crop would remove the whole scene");

// --- drop the pruned graph and the animation that references it ---
for (const node of gltf.nodes) if (node.children) node.children = node.children.filter(child => keep[child]);
delete gltf.animations; // "Movers" tracks reference nodes this crop removes

// --- collect what is still referenced, before any index moves ---
const used = { mesh: new Set(), material: new Set(), texture: new Set(), image: new Set(), sampler: new Set(), accessor: new Set(), view: new Set() };
gltf.nodes.forEach((node, index) => { if (keep[index] && node.mesh !== undefined) used.mesh.add(node.mesh); });
for (const index of used.mesh) for (const primitive of gltf.meshes[index].primitives) {
  for (const attribute of Object.values(primitive.attributes)) used.accessor.add(attribute);
  if (primitive.indices !== undefined) used.accessor.add(primitive.indices);
  if (primitive.material !== undefined) used.material.add(primitive.material);
}
const useTexture = info => {
  if (!info || info.index === undefined) return;
  used.texture.add(info.index);
  const texture = gltf.textures[info.index];
  if (texture.source !== undefined) used.image.add(texture.source);
  if (texture.sampler !== undefined) used.sampler.add(texture.sampler);
};
for (const index of used.material) {
  const material = gltf.materials[index];
  const pbr = material.pbrMetallicRoughness ?? {};
  useTexture(pbr.baseColorTexture); useTexture(pbr.metallicRoughnessTexture);
  useTexture(material.normalTexture); useTexture(material.occlusionTexture); useTexture(material.emissiveTexture);
}
for (const index of used.accessor) used.view.add(gltf.accessors[index].bufferView);
for (const index of used.image) used.view.add(gltf.images[index].bufferView);

// --- remap index tables, preserving old order so ids stay stable ---
const remap = set => {
  const table = new Map();
  [...set].sort((a, b) => a - b).forEach((old, index) => table.set(old, index));
  return table;
};
const maps = {
  mesh: remap(used.mesh), material: remap(used.material), texture: remap(used.texture),
  image: remap(used.image), sampler: remap(used.sampler), accessor: remap(used.accessor), view: remap(used.view),
};
const pick = (table, list) => [...table.keys()].sort((a, b) => a - b).map(old => list[old]);

for (const node of gltf.nodes) if (node.mesh !== undefined) node.mesh = maps.mesh.get(node.mesh);
for (const index of used.mesh) {
  const mesh = gltf.meshes[index];
  for (const primitive of mesh.primitives) {
    for (const [key, value] of Object.entries(primitive.attributes)) primitive.attributes[key] = maps.accessor.get(value);
    if (primitive.indices !== undefined) primitive.indices = maps.accessor.get(primitive.indices);
    if (primitive.material !== undefined) primitive.material = maps.material.get(primitive.material);
  }
}
for (const index of used.accessor) gltf.accessors[index].bufferView = maps.view.get(gltf.accessors[index].bufferView);
const rewriteTexture = info => { if (info && info.index !== undefined) info.index = maps.texture.get(info.index); };
for (const index of used.material) {
  const material = gltf.materials[index];
  const pbr = material.pbrMetallicRoughness ?? {};
  rewriteTexture(pbr.baseColorTexture); rewriteTexture(pbr.metallicRoughnessTexture);
  rewriteTexture(material.normalTexture); rewriteTexture(material.occlusionTexture); rewriteTexture(material.emissiveTexture);
}
for (const index of used.texture) {
  const texture = gltf.textures[index];
  if (texture.source !== undefined) texture.source = maps.image.get(texture.source);
  if (texture.sampler !== undefined) texture.sampler = maps.sampler.get(texture.sampler);
}
for (const index of used.image) gltf.images[index].bufferView = maps.view.get(gltf.images[index].bufferView);

// --- rebuild the BIN with 16-byte-aligned views ---
const parts = [];
let cursor = 0;
const reserve = length => {
  const start = (cursor + 15) & ~15;
  if (start > cursor) parts.push(Buffer.alloc(start - cursor));
  cursor = start + length;
  return start;
};
const newViews = new Array(used.view.size);
for (const old of [...used.view].sort((a, b) => a - b)) {
  const view = gltf.bufferViews[old];
  const offset = view.byteOffset ?? 0;
  // Reserve before appending: the alignment padding must land ahead of this view.
  const byteOffset = reserve(view.byteLength);
  parts.push(bin.subarray(offset, offset + view.byteLength));
  newViews[maps.view.get(old)] = { ...view, byteOffset };
}
const newBin = Buffer.concat(parts, cursor);

gltf.accessors = pick(maps.accessor, gltf.accessors);
gltf.bufferViews = newViews;
gltf.images = pick(maps.image, gltf.images);
gltf.textures = pick(maps.texture, gltf.textures);
gltf.materials = pick(maps.material, gltf.materials);
gltf.meshes = pick(maps.mesh, gltf.meshes);
if (gltf.samplers) gltf.samplers = pick(maps.sampler, gltf.samplers);
else delete gltf.samplers;
gltf.buffers[0].byteLength = newBin.length;

// --- write the GLB ---
const pad = (buffer, fill) => {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer;
};
const jsonChunk = pad(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
const binChunk = pad(newBin, 0x00);
const uint32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
const out = Buffer.concat([
  Buffer.from([0x67, 0x6c, 0x54, 0x46]), uint32(2),
  uint32(12 + 8 + jsonChunk.length + 8 + binChunk.length),
  uint32(jsonChunk.length), Buffer.from([0x4a, 0x53, 0x4f, 0x4e]), jsonChunk,
  uint32(binChunk.length), Buffer.from([0x42, 0x49, 0x4e, 0x00]), binChunk,
]);

const MB = n => (n / 1048576).toFixed(2);
console.log(`crop ±${HALF} at (${CENTER[0]}, ${CENTER[1]})`);
console.log(`  nodes    ${keep.filter(Boolean).length} / ${keep.length} kept`);
console.log(`  meshes   ${gltf.meshes.length}   materials ${gltf.materials.length}   images ${gltf.images.length}`);
console.log(`  size     ${MB(bytes.length)} MB -> ${MB(out.length)} MB`);
await writeFile(target, out);
