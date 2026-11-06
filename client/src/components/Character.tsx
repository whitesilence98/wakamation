"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Group, LoopOnce, LoopRepeat, Vector3, type AnimationAction, type AnimationClip, type SkinnedMesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AIR_TIME, type AnimationName } from "@game/shared/movement";
import { DEFAULT_CHARACTER, type CharacterId } from "@game/shared/social";
import { locomotionClips } from "./character-clips";
import { CHARACTER_HEIGHT, GAIT_SCALE } from "./character-size";
import { applyTint, disposeTint, setTintHue, tintColor } from "./character-tint";

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Capsule({ color }: { color: string }) {
  return <mesh position={[0, 0.9, 0]} castShadow>
    <capsuleGeometry args={[0.35, 1.1, 4, 12]} />
    <meshStandardMaterial color={color} roughness={0.65} />
    <mesh position={[0, 0.25, 0.33]}><boxGeometry args={[0.25, 0.12, 0.08]} /><meshStandardMaterial color="#142033" /></mesh>
  </mesh>;
}

function RunClips({ onLoad }: { onLoad: (clips: AnimationClip[]) => void }) {
  const { animations } = useGLTF("/models/characters/axolot/clips/run.glb");
  useEffect(() => onLoad(animations), [animations, onLoad]);
  return null;
}

function CharacterReady({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame(() => { if (++frames.current === 2) onReady?.(); });
  return null;
}

function Model({ character, animation, local, tint, onReady }: { character: CharacterId; animation: { current: AnimationName }; local: boolean; tint?: number; onReady?: () => void }) {
  const { scene, animations } = useGLTF(character === "gawr" ? "/models/characters/gawr/scene.gltf" : "/models/characters/axolot/axolot.glb");
  const [runClips, setRunClips] = useState<AnimationClip[]>([]);
  const clips = useMemo(() => locomotionClips(animations, runClips, character), [animations, runClips, character]);
  const root = useRef<Group>(null);
  const previous = useRef<AnimationAction | null>(null);
  const { model, scale, offset } = useMemo(() => {
    // SkeletonUtils.clone is essential: every avatar needs independent bones.
    const model = clone(scene);
    model.updateMatrixWorld(true);
    model.traverse(object => {
      object.castShadow = true;
      const mesh = object as SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        // Cached GLTF bounds predate initialized bone matrices on this asset.
        mesh.skeleton.update();
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    });
    // Independent materials: the clone above shares them with the cached scene.
    applyTint(model, 0);
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    const scale = CHARACTER_HEIGHT / Math.max(box.getSize(new Vector3()).y, 0.001);
    return { model, scale, offset: [-center.x * scale, -box.min.y * scale, -center.z * scale] as [number, number, number] };
  }, [scene]);
  useEffect(() => { setTintHue(model, tint ?? 0); }, [model, tint]);
  useEffect(() => () => disposeTint(model), [model]);
  const { actions } = useAnimations(clips, root);
  useEffect(() => { previous.current = null; }, [clips]);
  useFrame(() => {
    const requestedJump = animation.current === "Jump";
    const jumping = requestedJump && !!actions.Jump;
    // ponytail: gawr has no Jump clip; retain locomotion until a matching clip exists.
    const next = actions[animation.current] ?? (requestedJump ? previous.current ?? actions.Idle : actions.Walk);
    if (!next) return;
    // Landing always passes through Idle/Walk, so a second jump is a different
    // action than the held one-shot and starts from the top on its own.
    if (next === previous.current) return;
    const previousAction = previous.current;
    if (jumping) {
      // One-shot retimed to the simulated airtime, so the pose lands as the feet do.
      const duration = next.getClip().duration || AIR_TIME;
      next.reset().setLoop(LoopOnce, 1).setEffectiveTimeScale(duration / AIR_TIME);
      next.clampWhenFinished = true;
      next.fadeIn(0.08).play();
      previousAction?.fadeOut(0.08);
    } else {
      const locomotion = next.getClip().name !== "Idle";
      const phase = locomotion && previousAction && /^(Walk|Run)$/.test(previousAction.getClip().name)
        ? (previousAction.time / previousAction.getClip().duration) % 1 : 0;
      next.reset().setLoop(LoopRepeat, Infinity).setEffectiveTimeScale(locomotion && character === "axolot" ? GAIT_SCALE : 1);
      next.time = phase * next.getClip().duration;
      const fade = previousAction?.getClip().name === "Jump" ? 0.08 : 0.25;
      next.fadeIn(fade).play();
      previousAction?.fadeOut(fade);
    }
    previous.current = next;
    if (local) document.documentElement.dataset.clip = next.getClip().name;
  });
  return <group ref={root}>
    <CharacterReady onReady={onReady} />
    <group scale={scale} position={offset}><primitive object={model} /></group>
    {character === "axolot" && <ModelBoundary fallback={null}><Suspense fallback={null}><RunClips onLoad={setRunClips} /></Suspense></ModelBoundary>}
  </group>;
}

export function Character({ character = DEFAULT_CHARACTER, animation, local = false, tint, onReady }: { character?: CharacterId; animation: { current: AnimationName }; local?: boolean; tint?: number; onReady?: () => void }) {
  const fallback = <group scale={CHARACTER_HEIGHT / 1.8}><Capsule color={tint === undefined ? "#fb923c" : `#${tintColor(tint).getHexString()}`} /></group>;
  return <ModelBoundary key={character} fallback={<>{fallback}<CharacterReady onReady={onReady} /></>}><Suspense fallback={fallback}><Model character={character} animation={animation} local={local} tint={tint} onReady={onReady} /></Suspense></ModelBoundary>;
}
