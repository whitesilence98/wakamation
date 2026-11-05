"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Vector3 } from "three";
import type { AnimationName } from "@game/shared/movement";
import { RENDER_SNAP_DISTANCE } from "@game/shared/movement";
import { useGame } from "@/network/GameProvider";
import { Character } from "./Character";
import { hueForColor } from "./character-tint";
import { PlayerLabel } from "./PlayerLabel";

export function RemoteCharacter({ id }: { id: string }) {
  const { snapshots, profiles } = useGame();
  const group = useRef<Group>(null);
  const initialized = useRef(false);
  const target = useRef(new Vector3());
  const animation = useRef<AnimationName>("Idle");
  useFrame((_, dt) => {
    const state = snapshots.current.get(id);
    if (!state || !group.current) return;
    target.current.set(state.x, state.y, state.z);
    const alpha = 1 - Math.exp(-12 * dt);
    if (!initialized.current || group.current.position.distanceToSquared(target.current) > RENDER_SNAP_DISTANCE ** 2) {
      group.current.position.copy(target.current);
      group.current.rotation.y = state.rotation;
      initialized.current = true;
    } else {
      group.current.position.lerp(target.current, alpha);
      // Vertical is not lerped: the jump arc is ~150 u/s, so a 12/s gain would put
      // the remote avatar a dozen units off the authoritative height.
      group.current.position.y = target.current.y;
      const delta = Math.atan2(Math.sin(state.rotation - group.current.rotation.y), Math.cos(state.rotation - group.current.rotation.y));
      group.current.rotation.y += delta * alpha;
    }
    animation.current = state.currentAnimation;
  });
  return <group ref={group}><Character animation={animation} tint={hueForColor(profiles.get(id)?.color, id)} /><PlayerLabel id={id} /></group>;
}
