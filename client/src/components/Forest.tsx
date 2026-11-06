"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from "three";
import { CLEARING_RADIUS, FOREST_ASSETS, FOREST_GROUND_Y, FOREST_HALF, FOREST_PATHS, FOREST_PLACEMENTS, PATH_HALF_WIDTH, type ForestKind, type ForestPlacement } from "@game/shared/forest";
import { forestChunks } from "./forest-chunks";
import { showForestPlacement, type GraphicsSettings } from "./graphics-settings";

function Instances({ source, placements, distance }: { source: Mesh; placements: readonly ForestPlacement[]; distance: number }) {
  const ref = useRef<InstancedMesh>(null);
  const cameraPosition = useMemo(() => new Vector3(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4(), rotation = new Quaternion(), up = new Vector3(0, 1, 0);
    const position = new Vector3(), scale = new Vector3();
    placements.forEach((p, i) => {
      position.set(p.x, FOREST_GROUND_Y, p.z);
      rotation.setFromAxisAngle(up, p.yaw);
      scale.setScalar(p.scale);
      matrix.compose(position, rotation, scale).multiply(source.matrixWorld);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [source, placements]);
  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!Number.isFinite(distance) || !mesh?.boundingBox) return;
    camera.getWorldPosition(cameraPosition);
    mesh.worldToLocal(cameraPosition);
    // ponytail: hard cutoff inside fog; add a fade only if popping is distracting.
    mesh.visible = mesh.boundingBox.distanceToPoint(cameraPosition) <= distance;
  });
  // Cached geometry/materials are constructor args, not owned R3F children.
  return <instancedMesh ref={ref} args={[source.geometry, source.material, placements.length]} />;
}

function Vegetation({ kind, graphics }: { kind: ForestKind; graphics: GraphicsSettings }) {
  const { scene } = useGLTF(`/models/forest/${kind}.gltf`);
  const meshes = useMemo(() => {
    scene.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    scene.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
    return meshes;
  }, [scene]);
  const chunks = useMemo(() => forestChunks(FOREST_PLACEMENTS.filter(p => p.kind === kind && showForestPlacement(p, graphics.foliage))), [kind, graphics.foliage]);
  const distance = FOREST_ASSETS[kind].blocking ? Infinity : graphics.viewDistance * 2 / 3;
  return <>{chunks.map((placements, i) => meshes.map(mesh => <Instances key={`${i}-${mesh.uuid}`} source={mesh} placements={placements} distance={distance} />))}</>;
}

function Paths() {
  const vertices = useMemo(() => {
    const vertices: number[] = [];
    for (const path of FOREST_PATHS) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const nx = -(b.z - a.z) / length * PATH_HALF_WIDTH;
        const nz = (b.x - a.x) / length * PATH_HALF_WIDTH;
        const leftA = [a.x + nx, 0.012, a.z + nz], rightA = [a.x - nx, 0.012, a.z - nz];
        const leftB = [b.x + nx, 0.012, b.z + nz], rightB = [b.x - nx, 0.012, b.z - nz];
        vertices.push(...leftA, ...leftB, ...rightA, ...rightA, ...leftB, ...rightB);
      }
      // Round joins share the path's geometry/material, not one draw per point.
      for (const p of path) for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6, b = (i + 1) * Math.PI / 6;
        vertices.push(p.x, 0.011, p.z,
          p.x + Math.cos(b) * PATH_HALF_WIDTH, 0.011, p.z + Math.sin(b) * PATH_HALF_WIDTH,
          p.x + Math.cos(a) * PATH_HALF_WIDTH, 0.011, p.z + Math.sin(a) * PATH_HALF_WIDTH);
      }
    }
    return new Float32Array(vertices);
  }, []);
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
      <circleGeometry args={[CLEARING_RADIUS, 64]} />
      <meshStandardMaterial color="#8b8050" roughness={1} />
    </mesh>
    <mesh receiveShadow>
      <bufferGeometry onUpdate={geometry => geometry.computeVertexNormals()}>
        <bufferAttribute attach="attributes-position" args={[vertices, 3]} />
      </bufferGeometry>
      <meshStandardMaterial color="#8b8050" roughness={1} />
    </mesh>
  </>;
}

export function Forest({ graphics }: { graphics: GraphicsSettings }) {
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FOREST_GROUND_Y, 0]} receiveShadow>
      <planeGeometry args={[(FOREST_HALF + 16) * 2, (FOREST_HALF + 16) * 2]} />
      <meshStandardMaterial color="#526c38" roughness={1} />
    </mesh>
    <Paths />
    {(Object.keys(FOREST_ASSETS) as ForestKind[]).map(kind => <Vegetation key={kind} kind={kind} graphics={graphics} />)}
  </group>;
}
