import { AnimationClip } from "three";

// The file the jump clip is loaded from. The clip inside it may be named anything
// close to "jump"; playback always uses the action name "Jump".
export const JUMP_CLIP = "jump.glb";

const normalized = (name: string) => name.replace(/^Armature\|/i, "").replace(/\|baselayer$/i, "").toLowerCase();

/**
 * Locomotion plus the one-shot jump.
 *
 * `jump` is a separate source on purpose: the jump is a placeholder today and is
 * expected to be swapped. Any file whose clip is named `jump` is picked up here,
 * and the action name the rest of the client plays stays "Jump".
 */
export function locomotionClips(character: AnimationClip[], extra: AnimationClip[] = [], jump: AnimationClip[] = []) {
  const walk = character.find(clip => normalized(clip.name) === "walking_man");
  if (!walk) throw new Error("Character is missing walking_man");
  const run = extra.find(clip => normalized(clip.name) === "running");
  const leap = jump.find(clip => normalized(clip.name) === "jump") ?? jump[0];
  // ponytail: no Idle asset; hold the first walk pose until a real Idle is supplied.
  const tracks = walk.tracks.map(track => {
    const held = track.clone();
    const first = track.values.slice(0, track.getValueSize());
    held.times = new Float32Array([0, 1]);
    held.values = new Float32Array([...first, ...first]);
    return held;
  });
  const walking = walk.clone();
  walking.name = "Walk";
  const clips = [new AnimationClip("Idle", 1, tracks), walking];
  if (run) {
    const running = run.clone();
    running.name = "Run";
    clips.push(running);
  }
  if (leap) {
    const jumping = leap.clone();
    jumping.name = "Jump";
    clips.push(jumping);
  }
  return clips;
}
