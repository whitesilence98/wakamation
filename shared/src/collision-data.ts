import { FOREST_HALF, FOREST_OBSTACLES, HOUSE } from "./forest.js";

export const GRID_CELL = 0.5;
export const GRID_HALF = FOREST_HALF;
export const GRID_SIZE = GRID_HALF * 2 / GRID_CELL;
export const COLLISION_BITS = new Uint8Array(Math.ceil(GRID_SIZE * GRID_SIZE / 8));

// Rasterize once; the movement solver applies PLAYER_RADIUS to these cells.
for (const obstacle of FOREST_OBSTACLES) {
  const firstX = Math.max(0, Math.floor((obstacle.x - obstacle.radius + GRID_HALF) / GRID_CELL));
  const lastX = Math.min(GRID_SIZE - 1, Math.floor((obstacle.x + obstacle.radius + GRID_HALF) / GRID_CELL));
  const firstZ = Math.max(0, Math.floor((obstacle.z - obstacle.radius + GRID_HALF) / GRID_CELL));
  const lastZ = Math.min(GRID_SIZE - 1, Math.floor((obstacle.z + obstacle.radius + GRID_HALF) / GRID_CELL));
  for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
    const left = x * GRID_CELL - GRID_HALF, bottom = z * GRID_CELL - GRID_HALF;
    const dx = obstacle.x - Math.max(left, Math.min(left + GRID_CELL, obstacle.x));
    const dz = obstacle.z - Math.max(bottom, Math.min(bottom + GRID_CELL, obstacle.z));
    if (dx * dx + dz * dz > obstacle.radius ** 2) continue;
    const index = z * GRID_SIZE + x;
    COLLISION_BITS[index >> 3] = COLLISION_BITS[index >> 3]! | (1 << (index & 7));
  }
}

// ponytail: solid bounds include roof overhangs; use authored wall footprints for interiors.
const firstX = Math.max(0, Math.floor((HOUSE.x - HOUSE.width / 2 + GRID_HALF) / GRID_CELL));
const lastX = Math.min(GRID_SIZE - 1, Math.ceil((HOUSE.x + HOUSE.width / 2 + GRID_HALF) / GRID_CELL) - 1);
const firstZ = Math.max(0, Math.floor((HOUSE.z - HOUSE.depth / 2 + GRID_HALF) / GRID_CELL));
const lastZ = Math.min(GRID_SIZE - 1, Math.ceil((HOUSE.z + HOUSE.depth / 2 + GRID_HALF) / GRID_CELL) - 1);
for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
  const index = z * GRID_SIZE + x;
  COLLISION_BITS[index >> 3] = COLLISION_BITS[index >> 3]! | (1 << (index & 7));
}
