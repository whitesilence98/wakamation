import { COLLISION_BITS, GRID_CELL, GRID_HALF, GRID_SIZE } from "./collision-data.js";

export const PLAYER_RADIUS = 0.35;
// The map is a child's bedroom seen from toy scale, and the arena is the top of
// the giant checkerboard board the toys stand on. The room floor is MAP_FLOOR_Y
// in the asset, which the renderer lifts to y = 0, so the board is ~91 units up:
// players walk on the board, not the floor. Measured from map.cropped.glb, the
// board arches from 87.8 at its edges to 91.1 at its centre; GROUND_Y is its
// height at the spawn point. A single constant is exact only while movement
// stays flat — the arch itself is not modelled.
export const GROUND_Y = 91.1;
const bits = Uint8Array.from(atob(COLLISION_BITS), char => char.charCodeAt(0));
const cell = (value: number) => Math.floor((value + GRID_HALF) / GRID_CELL);
const edge = (index: number) => index * GRID_CELL - GRID_HALF;
const blocked = (x: number, z: number) => x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE
  || ((bits[(z * GRID_SIZE + x) >> 3]! >> ((z * GRID_SIZE + x) & 7)) & 1) !== 0;

export function canStand(x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) + PLAYER_RADIUS > GRID_HALF || Math.abs(z) + PLAYER_RADIUS > GRID_HALF) return false;
  for (let iz = cell(z - PLAYER_RADIUS); iz <= cell(z + PLAYER_RADIUS); iz++) {
    for (let ix = cell(x - PLAYER_RADIUS); ix <= cell(x + PLAYER_RADIUS); ix++) {
      if (!blocked(ix, iz)) continue;
      const dx = x - Math.max(edge(ix), Math.min(edge(ix + 1), x));
      const dz = z - Math.max(edge(iz), Math.min(edge(iz + 1), z));
      if (dx * dx + dz * dz < PLAYER_RADIUS ** 2 - 1e-10) return false;
    }
  }
  return true;
}

// Sweep the circle along one axis; checking endpoints alone can skip narrow corners.
function slide(start: number, other: number, delta: number, alongX: boolean): number {
  if (delta === 0) return start;
  let end = Math.max(-GRID_HALF + PLAYER_RADIUS, Math.min(GRID_HALF - PLAYER_RADIUS, start + delta));
  const first = cell(Math.min(start, end) - PLAYER_RADIUS), last = cell(Math.max(start, end) + PLAYER_RADIUS);
  for (let a = first; a <= last; a++) for (let b = cell(other - PLAYER_RADIUS); b <= cell(other + PLAYER_RADIUS); b++) {
    if (!blocked(alongX ? a : b, alongX ? b : a)) continue;
    const distance = other - Math.max(edge(b), Math.min(edge(b + 1), other));
    if (distance * distance >= PLAYER_RADIUS ** 2) continue;
    const padding = Math.sqrt(PLAYER_RADIUS ** 2 - distance * distance);
    const low = edge(a) - padding, high = edge(a + 1) + padding;
    if (delta > 0 && start <= low + 1e-8 && end > low) end = Math.max(start, low - 1e-7);
    if (delta < 0 && start >= high - 1e-8 && end < high) end = Math.min(start, high + 1e-7);
  }
  return end;
}

// ponytail: horizontal grid approximation; the mask has no heights, so jumps are
// purely vertical and cannot clear a blocked cell. Add shared terrain heights for slopes.
export function resolveMove(x: number, z: number, dx: number, dz: number): { x: number; z: number } {
  if (!canStand(x, z) || !Number.isFinite(dx) || !Number.isFinite(dz)) return { x, z };
  const nextX = slide(x, z, dx, true);
  const nextZ = slide(z, nextX, dz, false);
  return canStand(nextX, nextZ) ? { x: nextX, z: nextZ } : { x, z };
}

// Spawns are on the board's surface, so the returned y is GROUND_Y rather than 0.
export function findSpawn(taken: readonly { x: number; z: number }[], index = taken.length): { x: number; y: number; z: number } {
  for (let radius = 0; radius <= GRID_HALF - PLAYER_RADIUS; radius += 0.25) {
    const samples = Math.max(1, Math.ceil(2 * Math.PI * radius / 0.25));
    for (let i = 0; i < samples; i++) {
      const angle = index * 2.4 + i * 2 * Math.PI / samples;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      if (canStand(x, z) && taken.every(p => Math.hypot(p.x - x, p.z - z) >= 1.2)) return { x, y: GROUND_Y, z };
    }
  }
  throw new Error("No clear map spawn available");
}
