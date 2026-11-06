"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Group, Vector3 } from "three";
import { MAX_PENDING_INPUTS, RENDER_SNAP_DISTANCE, TICK_DT, reconcile, stepPlayer, type AnimationName, type InputMessage, type PlayerSnapshot } from "@game/shared/movement";
import { useGame } from "@/network/GameProvider";
import { Character } from "./Character";
import { hueForColor } from "./character-tint";
import { PlayerLabel } from "./PlayerLabel";

const controls = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);

export function LocalCharacter({ cameraTarget, onReady }: { cameraTarget: MutableRefObject<Vector3>; onReady?: () => void }) {
  const { snapshots, revision, sessionId, sendInput, profiles } = useGame();
  const body = useRef<RapierRigidBody>(null);
  const visual = useRef<Group>(null);
  const keys = useRef(new Set<string>());
  // Jump is edge-triggered: holding Space must not queue a jump every step.
  const jumpQueued = useRef(false);
  const pending = useRef<InputMessage[]>([]);
  const predicted = useRef<PlayerSnapshot | null>(null);
  const sequence = useRef(0);
  const seenRevision = useRef(-1);
  const accumulator = useRef(0);
  const animation = useRef<AnimationName>("Idle");
  const target = useRef(new Vector3());
  const movementForward = useRef(new Vector3(0, 0, 1));
  const movementRight = useRef(new Vector3(-1, 0, 0));

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (document.querySelector("dialog[open]") || target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return;
      // A focused control already owns Space (talk button, voice switch): let it act.
      const owner = target instanceof Element ? target.closest("button, [role='switch'], [role='button'], a[href]") : null;
      if (event.code === "Space" && owner) return;
      if (controls.has(event.code)) {
        event.preventDefault();
        keys.current.add(event.code);
        if (event.code === "Space" && !event.repeat) jumpQueued.current = true;
      }
    };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.code); };
    const clear = () => { keys.current.clear(); accumulator.current = 0; jumpQueued.current = false; };
    const focus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (document.querySelector("dialog[open]") || target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) clear();
    };
    document.addEventListener("focusin", focus);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      document.removeEventListener("focusin", focus);
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  useFrame(({ camera }, delta) => {
    if (!sessionId) return;
    const truth = snapshots.current.get(sessionId);
    if (!truth) return;
    if (seenRevision.current !== revision.current) {
      seenRevision.current = revision.current;
      pending.current = pending.current.filter(input => input.seq > truth.lastProcessedSeq);
      predicted.current = reconcile(truth, pending.current);
    }
    const player = predicted.current;
    if (!player) return;
    // No wall-clock catch-up after a hidden tab: bounded input and simulation work.
    accumulator.current = Math.min(accumulator.current + delta, 0.1);
    while (accumulator.current >= TICK_DT) {
      accumulator.current -= TICK_DT;
      if (pending.current.length >= MAX_PENDING_INPUTS || document.hidden) break;
      const pressed = (...codes: string[]) => codes.some(code => keys.current.has(code));
      const forward = Number(pressed("KeyW", "ArrowUp")) - Number(pressed("KeyS", "ArrowDown"));
      const right = Number(pressed("KeyD", "ArrowRight")) - Number(pressed("KeyA", "ArrowLeft"));
      // The orbit camera turns only on explicit input, so sampling it cannot steer itself.
      camera.getWorldDirection(movementForward.current);
      movementForward.current.y = 0;
      if (movementForward.current.lengthSq() < 1e-8) movementForward.current.set(0, 0, 1);
      else movementForward.current.normalize();
      movementRight.current.set(-movementForward.current.z, 0, movementForward.current.x);
      const divisor = Math.max(1, Math.hypot(forward, right));
      const input: InputMessage = {
        seq: sequence.current + 1,
        forward: Math.max(-1, Math.min(1, -(movementForward.current.z * forward + movementRight.current.z * right) / divisor)),
        right: Math.max(-1, Math.min(1, (movementForward.current.x * forward + movementRight.current.x * right) / divisor)),
        run: pressed("ShiftLeft", "ShiftRight"),
        // Only the first step after a keypress carries the jump; it is a takeoff
        // impulse, and the server ignores it while airborne anyway.
        jump: jumpQueued.current || undefined,
      };
      if (!sendInput(input)) break;
      jumpQueued.current = false;
      sequence.current = input.seq;
      pending.current.push(input);
      stepPlayer(player, input);
    }
    animation.current = player.currentAnimation;
    body.current?.setNextKinematicTranslation({ x: player.x, y: player.y, z: player.z });
    if (visual.current) {
      const alpha = 1 - Math.exp(-25 * delta);
      target.current.set(player.x, player.y, player.z);
      if (visual.current.position.distanceToSquared(target.current) > RENDER_SNAP_DISTANCE ** 2) visual.current.position.copy(target.current);
      else visual.current.position.lerp(target.current, alpha);
      const yawDelta = Math.atan2(Math.sin(player.rotation - visual.current.rotation.y), Math.cos(player.rotation - visual.current.rotation.y));
      visual.current.rotation.y += yawDelta * alpha;
      cameraTarget.current.copy(visual.current.position);
    }
  });

  return <>
    {/* Kinematic proxy only: the server owns movement, not the client physics solver. */}
    <RigidBody ref={body} type="kinematicPosition" colliders={false} enabledRotations={[false, false, false]}>
      <CapsuleCollider args={[0.55, 0.35]} position={[0, 0.9, 0]} sensor />
    </RigidBody>
    <group ref={visual}><Character character={sessionId ? profiles.get(sessionId)?.character : undefined} animation={animation} local onReady={onReady} tint={sessionId ? hueForColor(profiles.get(sessionId)?.color, sessionId) : undefined} />{sessionId && <PlayerLabel id={sessionId} />}</group>
  </>;
}
