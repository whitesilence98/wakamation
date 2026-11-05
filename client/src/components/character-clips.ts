import { AnimationClip } from "three";

const normalized = (name: string) => name.replace(/^Armature\|/i, "").replace(/\|baselayer$/i, "").toLowerCase();

export function locomotionClips(character: AnimationClip[], extra: AnimationClip[] = []) {
  const walk = character.find(clip => normalized(clip.name) === "walking_man");
  if (!walk) throw new Error("Character is missing walking_man");
  const run = extra.find(clip => normalized(clip.name) === "running");
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
  return clips;
}
