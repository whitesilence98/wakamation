import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AnimationMixer, Box3, Vector3 } from "three";
import { locomotionClips } from "../client/src/components/character-clips.ts";
import { CHARACTER_HEIGHT } from "../client/src/components/character-size.ts";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

// Inspect the supplied rig without loading its browser-only textures.
// Node lacks this browser event; GLTFLoader uses it for buffer progress.
globalThis.ProgressEvent = class extends Event {} as typeof ProgressEvent;
async function load(path: string) {
  const bytes = await readFile(new URL(path, import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  const binary = bytes.subarray(28 + length);
  json.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString("base64")}`;
  delete json.images; delete json.textures; delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  return new GLTFLoader().parseAsync(JSON.stringify(json), "");
}
const gltf = await load("../client/public/models/characters/axolot/axolot.glb");
const run = await load("../client/public/models/characters/axolot/clips/run.glb");
const model = clone(gltf.scene);
const before = new Box3().setFromObject(model).getSize(new Vector3()).y;
model.updateMatrixWorld(true);
model.traverse(object => {
  if ("isSkinnedMesh" in object && object.isSkinnedMesh) {
    const mesh = object as import("three").SkinnedMesh;
    mesh.skeleton.update();
    mesh.computeBoundingBox();
  }
});
const box = new Box3().setFromObject(model);
const height = box.getSize(new Vector3()).y;
const scale = CHARACTER_HEIGHT / height;
console.log({ before, height, scale });
assert.ok(Number.isFinite(height) && height > 0);
model.scale.multiplyScalar(scale);
model.updateMatrixWorld(true);
const actual = new Box3().setFromObject(model).getSize(new Vector3()).y;
assert.ok(Math.abs(actual - CHARACTER_HEIGHT) < 0.01, `Expected ${CHARACTER_HEIGHT}-unit character; got ${actual}`);

const clips = locomotionClips(gltf.animations, run.animations);
assert.deepEqual(clips.map(clip => clip.name), ["Idle", "Walk", "Run", "Jump"]);
assert.deepEqual(locomotionClips(gltf.animations).map(clip => clip.name), ["Idle", "Walk", "Jump"]);
const bones: import("three").Bone[] = [];
model.traverse(object => { if (object.type === "Bone") bones.push(object as import("three").Bone); });
const pose = () => bones.flatMap(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
const mixer = new AnimationMixer(model);
const other = clone(gltf.scene);
const untouched = other.getObjectByName("LeftLeg")!.quaternion.clone();
for (const clip of clips) {
  assert.ok(clip.duration > 0 && clip.validate(), `${clip.name} must be a valid positive-duration clip`);
  for (const track of clip.tracks) assert.ok(model.getObjectByName(track.name.split(".")[0]!), `Unbound track: ${track.name}`);
  mixer.stopAllAction();
  mixer.clipAction(clip).reset().play();
  mixer.update(0.05);
  const first = pose();
  mixer.update(0.15);
  const change = Math.max(...pose().map((value, i) => Math.abs(value - first[i]!)));
  assert.ok(clip.name === "Idle" ? change < 1e-6 : change > 0.01, `${clip.name} pose change: ${change}`);
}
assert.ok(other.getObjectByName("LeftLeg")!.quaternion.equals(untouched), "Avatar skeletons must be independent");
// Jump must not add translation or spin: shared physics owns the entire arc.
const jumpClip = clips.find(clip => clip.name === "Jump")!;
for (const track of jumpClip.tracks.filter(track => track.name.endsWith(".position"))) {
  const size = track.getValueSize();
  for (let i = size; i < track.values.length; i++) {
    assert.equal(track.values[i], track.values[i % size], `${track.name} must stay fixed`);
  }
}
const hipsRotation = jumpClip.tracks.find(track => track.name === "Hips.quaternion")!;
assert.deepEqual([...hipsRotation.values.slice(0, 4)], [...hipsRotation.values.slice(-4)]);
mixer.stopAllAction();
console.log("Idle holds; Walk/Run animate; procedural Jump binds without root motion; independent clones verified.");
