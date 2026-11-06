export const FOREST_HALF = 40;
export const FOREST_GROUND_Y = 0;
export const CLEARING_RADIUS = 8;
export const PATH_HALF_WIDTH = 1.6;
// Scaled bounds of house.glb; update dimensions when replacing the model.
export const HOUSE = { x: 0, z: 14, width: 4.887207634663656, depth: 10 } as const;

type Point = { x: number; z: number };
export type ForestKind = "CommonTree_1" | "CommonTree_3" | "Pine_1" | "Bush_Common" | "Rock_Medium_1" | "Grass_Common_Short" | "Fern_1" | "Flower_3_Group";
export const FOREST_ASSETS: Record<ForestKind, { scale: number; radius: number; blocking: boolean; shadow: boolean }> = {
  CommonTree_1: { scale: 1, radius: 0.5, blocking: true, shadow: true },
  CommonTree_3: { scale: 1, radius: 0.45, blocking: true, shadow: true },
  Pine_1: { scale: 1, radius: 0.5, blocking: true, shadow: true },
  Bush_Common: { scale: 0.65, radius: 1, blocking: false, shadow: false },
  Rock_Medium_1: { scale: 0.55, radius: 2.5, blocking: true, shadow: true },
  Grass_Common_Short: { scale: 0.3, radius: 0.5, blocking: false, shadow: false },
  Fern_1: { scale: 0.14, radius: 4.7, blocking: false, shadow: false },
  Flower_3_Group: { scale: 0.28, radius: 1, blocking: false, shadow: false },
};
export interface ForestPlacement extends Point { kind: ForestKind; yaw: number; scale: number; radius: number }

const loop: Point[] = Array.from({ length: 65 }, (_, i) => {
  const angle = i * Math.PI * 2 / 64;
  return { x: Math.cos(angle) * 24, z: Math.sin(angle) * 21 };
});
export const FOREST_PATHS: readonly (readonly Point[])[] = [
  loop,
  [{ x: -24, z: 0 }, { x: -12, z: -2 }, { x: 0, z: 0 }, { x: 12, z: 2 }, { x: 24, z: 0 }],
];

export function distanceToForestPath(x: number, z: number): number {
  let distance = Infinity;
  for (const path of FOREST_PATHS) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return distance;
}

// ponytail: fixed flat forest with circular trunk/rock footprints, not mesh physics;
// add shared terrain heights and authored footprints before slopes or climbable props.
export function createForest(): ForestPlacement[] {
  let seed = 0x5eed1234;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const placements: ForestPlacement[] = [];
  const trees: ForestKind[] = ["CommonTree_1", "CommonTree_3", "Pine_1"];
  const add = (kind: ForestKind, x: number, z: number, variation: number) => {
    const asset = FOREST_ASSETS[kind], scale = asset.scale * variation, radius = asset.radius * scale;
    // Extra clearance covers the conservative grid cells and the player capsule.
    const clearance = radius + 1.2;
    if (Math.hypot(x, z) < CLEARING_RADIUS + clearance || distanceToForestPath(x, z) < PATH_HALF_WIDTH + clearance) return;
    if (asset.blocking && placements.some(p => FOREST_ASSETS[p.kind].blocking && Math.hypot(p.x - x, p.z - z) < p.radius + radius + 1)) return;
    placements.push({ kind, x, z, scale, radius, yaw: random() * Math.PI * 2 });
  };
  // Jittered groves also extend beyond the playable square to hide its boundary.
  for (let z = -46; z <= 46; z += 4.2) for (let x = -46; x <= 46; x += 4.2) {
    if (Math.max(Math.abs(x), Math.abs(z)) < 35 && random() < 0.18) continue;
    add(trees[Math.floor(random() * trees.length)]!, x + (random() - 0.5) * 2.8, z + (random() - 0.5) * 2.8, 0.8 + random() * 0.5);
  }
  for (let i = 0; i < 100; i++) add("Rock_Medium_1", (random() - 0.5) * 76, (random() - 0.5) * 76, 0.6 + random() * 0.8);
  for (const [kind, attempts] of [["Bush_Common", 300], ["Fern_1", 260], ["Grass_Common_Short", 3600], ["Flower_3_Group", 320]] as const) {
    for (let i = 0; i < attempts; i++) add(kind, (random() - 0.5) * 88, (random() - 0.5) * 88, 0.7 + random() * 0.6);
  }
  // Filter last so reserving the house does not change the seeded RNG sequence.
  return placements.filter(p => Math.hypot(
    Math.max(0, Math.abs(p.x - HOUSE.x) - HOUSE.width / 2),
    Math.max(0, Math.abs(p.z - HOUSE.z) - HOUSE.depth / 2),
  ) >= p.radius + 1.2);
}

export const FOREST_PLACEMENTS = createForest();
export const FOREST_OBSTACLES = FOREST_PLACEMENTS.filter(p => FOREST_ASSETS[p.kind].blocking);
