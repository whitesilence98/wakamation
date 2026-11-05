"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import { useGLTF } from "@react-three/drei";
import { GROUND_Y, MAP_FLOOR_Y, WORLD_LIMIT } from "@game/shared/movement";
import { DirectionalLight, Vector3 } from "three";
import { useGame } from "@/network/GameProvider";
import { LocalCharacter } from "./LocalCharacter";
import { RemoteCharacter } from "./RemoteCharacter";
import { VoiceSpatialAudio } from "./VoiceSpatialAudio";

function Map() {
  const { scene } = useGLTF("/models/map/map.cropped.glb");
  // The asset's room floor sits at MAP_FLOOR_Y; lift it so the room floor is y = 0.
  // Players walk on the board above it at GROUND_Y, which this leaves in place.
  // ponytail: shared collision grid handles horizontal movement; jumps are purely
  // vertical. Add shared terrain heights before slopes or landing on props.
  return <primitive object={scene} position={[0, -MAP_FLOOR_Y, 0]} />;
}

/**
 * Key light for the board. Built imperatively because a DirectionalLight aims at
 * its `target`, which R3F does not mount into the scene: the light's own target
 * would stay at the world origin below the board, aiming shadows away from it.
 * The shadow camera is centred on the board for the same reason.
 */
function Sun() {
  const light = useMemo(() => {
    const light = new DirectionalLight(0xffffff, 2.2);
    light.position.set(8, GROUND_Y + 18, 10);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    const camera = light.shadow.camera;
    camera.left = -28;
    camera.right = 28;
    camera.top = 28;
    camera.bottom = -28;
    camera.far = 70;
    camera.updateProjectionMatrix();
    light.target.position.set(0, GROUND_Y, 0);
    light.target.updateMatrixWorld();
    return light;
  }, []);
  return <primitive object={light} />;
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
    // Horizontal smoothing is deliberately soft. Height is copied exactly: the
    // jump arc peaks at ~150 u/s, and any exponential gain would lag it by
    // units/s, throwing the avatar out of a frame only ~3 units tall.
    const horizontalAlpha = 1 - Math.exp(-10 * dt);
    anchor.current.x += (target.current.x - anchor.current.x) * horizontalAlpha;
    anchor.current.z += (target.current.z - anchor.current.z) * horizontalAlpha;
    anchor.current.y = target.current.y;
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
  const { playerIds, sessionId, status, error } = useGame();
  const [readySession, setReadySession] = useState<string | null>(null);
  const ready = !!sessionId && readySession === sessionId && playerIds.includes(sessionId);
  const target = useRef(new Vector3());
  return <>
    {!ready && <div role="status" aria-live="polite" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--background)" }}>
      {error || (status === "connected" ? "Loading character…" : `${status}…`)}
    </div>}
    <Canvas style={{ visibility: ready ? "visible" : "hidden" }} shadows dpr={[1, 1.5]} camera={{ position: [0, GROUND_Y + 2.5, -5.2], fov: 55 }}>
    <color attach="background" args={["#101c2b"]} />
    {/* Fog is measured from the camera, so its range is independent of GROUND_Y. */}
    <fog attach="fog" args={["#101c2b", 60, 85]} />
    <ambientLight intensity={1.2} />
    <Sun />
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Map />
        <RigidBody type="fixed" colliders={false}>
          {/* Floor proxy sits under the board surface the players stand on. */}
          <CuboidCollider args={[WORLD_LIMIT + 1, 0.1, WORLD_LIMIT + 1]} position={[0, GROUND_Y - 0.1, 0]} />
        </RigidBody>
        {sessionId && playerIds.includes(sessionId) && <LocalCharacter key={sessionId} cameraTarget={target} onReady={() => setReadySession(sessionId)} />}
        {playerIds.filter(id => id !== sessionId).map(id => <RemoteCharacter key={id} id={id} />)}
      </Physics>
    </Suspense>
    <FollowCamera target={target} />
    <VoiceSpatialAudio />
  </Canvas>
  </>;
}
