"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Group, LoopRepeat, Vector3, type AnimationAction, type AnimationClip, type SkinnedMesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AnimationName } from "@game/shared/movement";
import { locomotionClips } from "./character-clips";
import { CHARACTER_HEIGHT, GAIT_SCALE } from "./character-size";

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Capsule({ local }: { local: boolean }) {
  return <mesh position={[0, 0.9, 0]} castShadow>
    <capsuleGeometry args={[0.35, 1.1, 4, 12]} />
    <meshStandardMaterial color={local ? "#38bdf8" : "#fb923c"} roughness={0.65} />
    <mesh position={[0, 0.25, 0.33]}><boxGeometry args={[0.25, 0.12, 0.08]} /><meshStandardMaterial color="#142033" /></mesh>
  </mesh>;
}

function RunClips({ onLoad }: { onLoad: (clips: AnimationClip[]) => void }) {
  const { animations } = useGLTF("/models/clips/run.glb");
  useEffect(() => onLoad(animations), [animations, onLoad]);
  return null;
}

function Model({ animation, local }: { animation: { current: AnimationName }; local: boolean }) {
  const { scene, animations } = useGLTF("/models/character.glb");
  const [runClips, setRunClips] = useState<AnimationClip[]>([]);
  const clips = useMemo(() => locomotionClips(animations, runClips), [animations, runClips]);
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
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    const scale = CHARACTER_HEIGHT / Math.max(box.getSize(new Vector3()).y, 0.001);
    return { model, scale, offset: [-center.x * scale, -box.min.y * scale, -center.z * scale] as [number, number, number] };
  }, [scene]);
  const { actions } = useAnimations(clips, root);
  useEffect(() => { previous.current = null; }, [clips]);
  useFrame(() => {
    const next = actions[animation.current] ?? actions.Walk;
    if (!next || next === previous.current) return;
    const previousAction = previous.current;
    const locomotion = next.getClip().name !== "Idle";
    const phase = locomotion && previousAction && previousAction.getClip().name !== "Idle"
      ? (previousAction.time / previousAction.getClip().duration) % 1 : 0;
    next.reset().setLoop(LoopRepeat, Infinity).setEffectiveTimeScale(locomotion ? GAIT_SCALE : 1);
    next.time = phase * next.getClip().duration;
    next.fadeIn(0.25).play();
    previousAction?.fadeOut(0.25);
    previous.current = next;
    if (local) document.documentElement.dataset.clip = next.getClip().name;
  });
  return <group ref={root}>
    <group scale={scale} position={offset}><primitive object={model} /></group>
    <ModelBoundary fallback={null}><Suspense fallback={null}><RunClips onLoad={setRunClips} /></Suspense></ModelBoundary>
  </group>;
}

export function Character({ animation, local = false }: { animation: { current: AnimationName }; local?: boolean }) {
  const fallback = <group scale={CHARACTER_HEIGHT / 1.8}><Capsule local={local} /></group>;
  return <ModelBoundary fallback={fallback}><Suspense fallback={fallback}><Model animation={animation} local={local} /></Suspense></ModelBoundary>;
}
