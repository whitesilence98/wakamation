"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import { GROUND_Y, WORLD_LIMIT } from "@game/shared/movement";
import { HOUSE } from "@game/shared/forest";
import { Box3, DirectionalLight, Vector3 } from "three";
import { useGame } from "@/network/GameProvider";
import { LocalCharacter } from "./LocalCharacter";
import { RemoteCharacter } from "./RemoteCharacter";
import { VoiceSpatialAudio } from "./VoiceSpatialAudio";
import { Forest } from "./Forest";
import type { GraphicsSettings } from "./graphics-settings";

function House() {
  const { scene } = useGLTF("/models/house/house.glb");
  const { model, scale, position } = useMemo(() => {
    const model = scene.clone(true);
    model.rotation.y += Math.PI;
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const width = Math.max(size.x, size.z);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(bounds.min.y)) throw new Error("House has invalid bounds");
    const scale = Math.max(HOUSE.width, HOUSE.depth) / width;
    return { model, scale, position: [HOUSE.x - center.x * scale, GROUND_Y - bounds.min.y * scale, HOUSE.z - center.z * scale] as [number, number, number] };
  }, [scene]);
  return <group scale={scale} position={position}><primitive object={model} dispose={null} /></group>;
}

function ViewDistance({ distance }: { distance: number }) {
  const camera = useThree(state => state.camera);
  useEffect(() => {
    camera.far = distance + 20;
    camera.updateProjectionMatrix();
  }, [camera, distance]);
  return null;
}

/** Aim the key light at the forest clearing, not the light's default target. */
function Sun({ shadows }: { shadows: boolean }) {
  const light = useMemo(() => {
    const light = new DirectionalLight(0xffebc4, 2.6);
    light.position.set(18, GROUND_Y + 32, 12);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.normalBias = 0.05;
    const camera = light.shadow.camera;
    camera.left = -WORLD_LIMIT - 8;
    camera.right = WORLD_LIMIT + 8;
    camera.top = WORLD_LIMIT + 8;
    camera.bottom = -WORLD_LIMIT - 8;
    camera.far = 120;
    camera.updateProjectionMatrix();
    light.target.position.set(0, GROUND_Y, 0);
    light.target.updateMatrixWorld();
    return light;
  }, []);
  return <primitive object={light} castShadow={shadows} />;
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
    // Follow the smoothed avatar height without adding a second vertical lag.
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

export default function GameScene({ graphics }: { graphics: GraphicsSettings }) {
  const [deviceDpr, setDeviceDpr] = useState(1);
  useEffect(() => {
    const update = () => setDeviceDpr(Math.max(1, Math.min(window.devicePixelRatio || 1, 2)));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const dpr = graphics.resolution === "performance" ? 0.75 : graphics.resolution === "hd" ? deviceDpr : 1;
  const { playerIds, sessionId, status, error } = useGame();
  const [readySession, setReadySession] = useState<string | null>(null);
  const ready = !!sessionId && readySession === sessionId && playerIds.includes(sessionId);
  const target = useRef(new Vector3());
  return <>
    {!ready && <div role="status" aria-live="polite" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--background)" }}>
      {error || (status === "connected" ? "Loading character…" : `${status}…`)}
    </div>}
    <Canvas style={{ visibility: ready ? "visible" : "hidden" }} shadows dpr={dpr} camera={{ position: [0, GROUND_Y + 2.5, -5.2], fov: 55 }}>
    <color attach="background" args={["#bdcfb3"]} />
    <fog attach="fog" args={["#bdcfb3", graphics.viewDistance * 26 / 54, graphics.viewDistance]} />
    <hemisphereLight args={["#deebff", "#52633c", 1.5]} />
    <Sun shadows={graphics.shadows} />
    <ViewDistance distance={graphics.viewDistance} />
    <Suspense fallback={null}>
      <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
        <Forest graphics={graphics} />
        <Suspense fallback={null}><House /></Suspense>
        <RigidBody type="fixed" colliders={false}>
          {/* Shared movement owns collision; this proxy sits under forest ground. */}
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
