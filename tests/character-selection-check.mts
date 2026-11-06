import assert from "node:assert/strict";
import { AnimationClip, NumberKeyframeTrack } from "three";
import { CHARACTER_IDS, DEFAULT_CHARACTER, isCharacter } from "../shared/src/social.ts";
import { locomotionClips } from "../client/src/components/character-clips.ts";

assert.equal(DEFAULT_CHARACTER, "axolot");
assert.deepEqual(CHARACTER_IDS, ["axolot", "gawr"]);
for (const id of CHARACTER_IDS) assert.ok(isCharacter(id));
for (const value of [null, undefined, {}, [], 1, "", "Gawr", "../gawr", "/models/other.glb"])
  assert.equal(isCharacter(value), false);

const source = ["ParadeWalk", "idle", "smolguraAnimationsRESOURCE"].map(name =>
  new AnimationClip(name, 1, [new NumberKeyframeTrack("Face.morphTargetInfluences[0]", [0, 1], [0, 1])])
);
const before = source.map(clip => clip.toJSON());
const clips = locomotionClips(source, [new AnimationClip("running", 1, [])], "gawr");
assert.deepEqual(clips.map(clip => clip.name), ["Idle", "Walk"]);
assert.deepEqual(source.map(clip => clip.toJSON()), before, "Cached clips must remain unchanged");
for (const [index, original] of [[0, 1], [1, 0]] as const) {
  assert.notEqual(clips[index], source[original]);
  assert.notEqual(clips[index]!.tracks[0], source[original]!.tracks[0]);
  assert.equal(clips[index]!.tracks[0]!.name, "Face.morphTargetInfluences[0]");
  assert.ok(clips[index]!.validate());
}
assert.throws(() => locomotionClips([], [], "gawr"), /missing idle/);
assert.throws(() => locomotionClips([source[1]!], [], "gawr"), /missing ParadeWalk/);
console.log("Character IDs and gawr clip mapping checks passed");
