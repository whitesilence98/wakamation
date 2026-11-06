import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { AIR_TIME } from "@game/shared/movement";
import { DEFAULT_CHARACTER, type CharacterId } from "@game/shared/social";

const normalized = (name: string) => name.replace(/^Armature\|/i, "").replace(/\|baselayer$/i, "").toLowerCase();

export function locomotionClips(character: AnimationClip[], extra: AnimationClip[] = [], id: CharacterId = DEFAULT_CHARACTER) {
  if (id === "gawr") {
    // ponytail: no rig-matched Run/Jump; reuse Walk/keep the current pose until supplied.
    return ([["idle", "Idle"], ["ParadeWalk", "Walk"]] as const).map(([source, name]) => {
      const clip = character.find(clip => clip.name === source);
      if (!clip) throw new Error(`gawr is missing ${source}`);
      const copy = clip.clone();
      copy.name = name;
      return copy;
    });
  }
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
  // ponytail: gentle procedural tuck, not the old attack clip. Replace with a
  // rig-matched authored jump when available; simulation owns all root motion.
  const bends: Record<string, number> = { LeftUpLeg: -0.25, RightUpLeg: -0.25,
    LeftLeg: 0.5, RightLeg: 0.5, LeftForeArm: -0.2, RightForeArm: -0.2 };
  const times = [0, 0.2, 0.5, 0.8, 1].map(t => t * AIR_TIME);
  const jumpTracks = tracks.map(track => {
    const [bone, property] = track.name.split(".");
    const bend = bends[bone!];
    if (property === "quaternion" && bend !== undefined) {
      const base = new Quaternion().fromArray(track.values);
      const axis = new Vector3(1, 0, 0);
      const values = [0, 0.6, 1, 0.6, 0].flatMap(weight => base.clone()
        .multiply(new Quaternion().setFromAxisAngle(axis, bend * weight)).toArray());
      return new QuaternionKeyframeTrack(track.name, times, values);
    }
    const held = track.clone();
    held.times = new Float32Array([0, AIR_TIME]);
    return held;
  });
  clips.push(new AnimationClip("Jump", AIR_TIME, jumpTracks));
  return clips;
}
