"use client";

import { Suspense, useEffect, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import { useGLTF } from "@react-three/drei";
import { WORLD_LIMIT } from "@game/shared/movement";
import { Vector3 } from "three";
import { useGame } from "@/network/GameProvider";
import { LocalCharacter } from "./LocalCharacter";
import { RemoteCharacter } from "./RemoteCharacter";

function Map() {
  const { scene } = useGLTF("/models/summoner-rift.glb");
  // The playable plateau is centered at X/Z zero, around Y 17.2; distant scenery skews the full bounds.
  // ponytail: shared collision grid handles horizontal movement; add shared terrain heights before slopes/jumping.
  return <primitive object={scene} scale={5} position={[0, -86, 0]} />;
}

function FollowCamera({ target }: { target: MutableRefObject<Vector3> }) {
  const canvas = useThree(state => state.gl.domElement);
  const anchor = useRef(new Vector3());
  const yaw = useRef(0);
  const pitch = useRef(0.32);
  const distance = useRef(5.5);
  useEffect(() => {
    let pointer: number | null = null;
    let x = 0;
    let y = 0;
    const oldCursor = canvas.style.cursor;
    canvas.style.cursor = "grab";
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
      pointer = event.pointerId;
      x = event.clientX;
      y = event.clientY;
      canvas.setPointerCapture(pointer);
      canvas.style.cursor = "grabbing";
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      yaw.current -= (event.clientX - x) * 0.005;
      pitch.current = Math.max(0.08, Math.min(1.2, pitch.current + (event.clientY - y) * 0.0035));
      x = event.clientX;
      y = event.clientY;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "grab";
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      distance.current = Math.max(3, Math.min(12, distance.current * Math.exp(pixels * 0.001)));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("lostpointercapture", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up);
      canvas.removeEventListener("wheel", wheel);
      if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
      canvas.style.cursor = oldCursor;
    };
  }, [canvas]);
  useFrame(({ camera }, dt) => {
    anchor.current.lerp(target.current, 1 - Math.exp(-10 * dt));
    const horizontal = Math.cos(pitch.current) * distance.current;
    camera.position.set(
      anchor.current.x - Math.sin(yaw.current) * horizontal,
      anchor.current.y + 0.8 + Math.sin(pitch.current) * distance.current,
      anchor.current.z - Math.cos(yaw.current) * horizontal,
    );
    camera.lookAt(anchor.current.x, anchor.current.y + 0.8, anchor.current.z);
  });
  return null;
}

export default function GameScene() {
  const { playerIds, sessionId } = useGame();
  const target = useRef(new Vector3());
  return <Canvas shadows dpr={[1, 1.5]} camera={{ position: [0, 2.5, -5.2], fov: 55 }}>
    <color attach="background" args={["#101c2b"]} />
    <fog attach="fog" args={["#101c2b", 30, 85]} />
    <ambientLight intensity={1.2} />
    <directionalLight castShadow position={[8, 18, 10]} intensity={2.2} shadow-mapSize={[1024, 1024]} shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={28} shadow-camera-bottom={-28} shadow-camera-far={70} />
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Map />
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[WORLD_LIMIT + 1, 0.1, WORLD_LIMIT + 1]} position={[0, -0.1, 0]} />
        </RigidBody>
        {sessionId && playerIds.includes(sessionId) && <LocalCharacter key={sessionId} cameraTarget={target} />}
        {playerIds.filter(id => id !== sessionId).map(id => <RemoteCharacter key={id} id={id} />)}
      </Physics>
    </Suspense>
    <FollowCamera target={target} />
  </Canvas>;
}
