// Builds client/public/models/clips/jump.glb from assets-source/attack.glb.
//
// The carrier (assets-source/walking-armature.glb) is a 64 KB armature-only
// export: same 24-joint rig, same bone names and inverse bind matrices as
// character.glb, but a placeholder mesh and one animation. We keep the
// carrier's mesh/skin and splice in the attack's 72 animation channels, so the
// result is a small clip-only file exactly like run.glb. Materials, images and
// textures never enter the output.
//
// The attack has baked root drift (Hips moves ~68 rig units forward over the
// clip). A clip used for jumping must stay in place, so the Hips translation
// track keeps its vertical Y curve and is pinned to the rest pose on X/Z.
//
//   node scripts/extract-jump-clip.mjs
//
// To swap the animation later (any GLB carrying a clip on this rig), change
// SOURCE below; the output clip name stays "Jump".
import { readFile, writeFile } from "node:fs/promises";

const CARRIER = new URL("../assets-source/walking-armature.glb", import.meta.url);
const SOURCE = new URL("../assets-source/attack.glb", import.meta.url);
const TARGET = new URL("../client/public/models/clips/jump.glb", import.meta.url);
const CLIP_NAME = "Jump";

function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error("Expected a glTF 2 GLB");
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("Expected a JSON first chunk");
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binStart);
  if (bytes.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error("Expected a BIN second chunk");
  if (gltf.buffers.length !== 1 || gltf.buffers[0].uri !== undefined) throw new Error("Expected one embedded buffer");
  return { gltf, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength) };
}

// Accessors that describe geometry and skinning (everything before the first
// animation-only accessor in both Khronos-exporter files).
const staticAccessorCount = gltf => {
  const used = new Set();
  for (const mesh of gltf.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const attribute of Object.values(primitive.attributes)) used.add(attribute);
    if (primitive.indices !== undefined) used.add(primitive.indices);
  }
  for (const skin of gltf.skins ?? []) if (skin.inverseBindMatrices !== undefined) used.add(skin.inverseBindMatrices);
  let index = 0;
  while (used.has(index)) index++;
  return index;
};

const carrier = readGlb(await readFile(CARRIER));
const source = readGlb(await readFile(SOURCE));

// Compare the skeleton, not the mesh node: the carrier's placeholder mesh node
// is named differently from the source's.
const carrierJoints = carrier.gltf.skins[0].joints.map(index => carrier.gltf.nodes[index].name);
const sourceJoints = source.gltf.skins[0].joints.map(index => source.gltf.nodes[index].name);
if (carrierJoints.length !== sourceJoints.length || carrierJoints.some((name, i) => name !== sourceJoints[i])) {
  throw new Error(`Skeleton mismatch: carrier has ${carrierJoints.length} joints, source has ${sourceJoints.length}`);
}
if (!source.gltf.animations?.length) throw new Error("Source has no animation");

const carrierStatic = staticAccessorCount(carrier.gltf);
const sourceStatic = staticAccessorCount(source.gltf);

// --- rebuild the binary: carrier static views first, then the clip's views ---
const parts = [];
let cursor = 0;
const reserve = length => {
  const start = (cursor + 3) & ~3;
  if (start > cursor) { parts.push(Buffer.alloc(start - cursor)); cursor = start; }
  cursor = start + length;
  return start;
};

const out = structuredClone(carrier.gltf);
out.accessors = out.accessors.slice(0, carrierStatic);

// Keep only the carrier buffer views that static accessors actually use.
const staticViews = new Set();
for (const accessor of out.accessors) staticViews.add(accessor.bufferView);
const viewMap = new Map();
const rebuiltViews = [];
for (const old of [...staticViews].sort((a, b) => a - b)) {
  const view = { ...carrier.gltf.bufferViews[old] };
  const offset = view.byteOffset ?? 0;
  const slice = carrier.bin.subarray(offset, offset + view.byteLength);
  viewMap.set(old, rebuiltViews.length);
  view.byteOffset = reserve(view.byteLength);
  delete view.byteStride;
  rebuiltViews.push(view);
  parts.push(slice);
}
for (const accessor of out.accessors) accessor.bufferView = viewMap.get(accessor.bufferView);

// The clip's own accessors, appended after the carrier's.
const clip = structuredClone(source.gltf.animations[0]);
const animationViews = new Set();
for (const sampler of clip.samplers) {
  animationViews.add(source.gltf.accessors[sampler.input].bufferView);
  animationViews.add(source.gltf.accessors[sampler.output].bufferView);
}
const animViewMap = new Map();
for (const old of [...animationViews].sort((a, b) => a - b)) {
  const view = { ...source.gltf.bufferViews[old] };
  const offset = view.byteOffset ?? 0;
  const slice = source.bin.subarray(offset, offset + view.byteLength);
  animViewMap.set(old, rebuiltViews.length);
  view.byteOffset = reserve(view.byteLength);
  delete view.byteStride;
  rebuiltViews.push(view);
  parts.push(slice);
}

// The outgoing view table must be in place before anything addresses it: the
// accessors below and the root-drift fix-up both use these indices/offsets.
out.bufferViews = rebuiltViews;

const accessorMap = new Map();
for (let old = sourceStatic; old < source.gltf.accessors.length; old++) {
  const accessor = structuredClone(source.gltf.accessors[old]);
  const view = animViewMap.get(accessor.bufferView);
  if (view === undefined) continue; // not referenced by this clip
  accessor.bufferView = view;
  accessorMap.set(old, out.accessors.length);
  out.accessors.push(accessor);
}
for (const sampler of clip.samplers) {
  sampler.input = accessorMap.get(sampler.input);
  sampler.output = accessorMap.get(sampler.output);
  if (sampler.input === undefined || sampler.output === undefined) throw new Error("Sampler references an accessor with no buffer view");
}

const bin = Buffer.concat(parts, cursor);

// --- keep the jump in place: preserve Hips Y, pin X/Z to the rest pose ---
const hips = out.nodes.findIndex(node => node.name === "Hips");
if (hips >= 0) {
  const rest = out.nodes[hips].translation ?? [0, 0, 0];
  for (const channel of clip.channels) {
    if (channel.target.node !== hips || channel.target.path !== "translation") continue;
    const accessor = out.accessors[clip.samplers[channel.sampler].output];
    if (accessor.type !== "VEC3") continue;
    const view = out.bufferViews[accessor.bufferView];
    const base = view.byteOffset + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? 12;
    for (let i = 0; i < accessor.count; i++) {
      bin.writeFloatLE(rest[0], base + i * stride);
      bin.writeFloatLE(rest[2], base + i * stride + 8);
    }
  }
}

// --- finish the document ---
clip.name = CLIP_NAME;
out.animations = [clip];
delete out.images; delete out.textures; delete out.materials; delete out.samplers;
for (const mesh of out.meshes) for (const primitive of mesh.primitives) delete primitive.material;
out.buffers[0].byteLength = bin.length;

const pad = (buffer, fill) => {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra, fill)]) : buffer;
};
const jsonChunk = pad(Buffer.from(JSON.stringify(out), "utf8"), 0x20);
const binChunk = pad(bin, 0x00);
// Chunk headers are a 4-byte length followed by the 4-byte type written below.
const header = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
const file = Buffer.concat([
  Buffer.from([0x67, 0x6c, 0x54, 0x46]), Buffer.from([2, 0, 0, 0]),
  header(12 + 8 + jsonChunk.length + 8 + binChunk.length),
  header(jsonChunk.length), Buffer.from([0x4a, 0x53, 0x4f, 0x4e]), jsonChunk,
  header(binChunk.length), Buffer.from([0x42, 0x49, 0x4e, 0x00]), binChunk,
]);

await writeFile(TARGET, file);
const duration = Math.max(...clip.samplers.map(sampler => out.accessors[sampler.input].max?.[0] ?? 0));
console.log(`Wrote ${CLIP_NAME} -> ${TARGET.pathname}`);
console.log(`  channels ${clip.channels.length}   duration ${duration.toFixed(3)}s   accessors ${out.accessors.length}   views ${out.bufferViews.length}`);
console.log(`  size ${(file.length / 1024).toFixed(1)} KB (source ${(source.bin.length / 1048576).toFixed(1)} MB, carrier ${(carrier.bin.length / 1024).toFixed(1)} KB)`);
