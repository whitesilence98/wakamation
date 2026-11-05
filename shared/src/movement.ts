import { GRID_HALF, MAP_FLOOR_Y } from "./collision-data.js";
import { GROUND_Y, resolveMove } from "./collision.js";
export { canStand, findSpawn, GROUND_Y, PLAYER_RADIUS, resolveMove } from "./collision.js";
export { MAP_FLOOR_Y } from "./collision-data.js";

export const TICK_MS = 50;
export const TICK_DT = TICK_MS / 1000;
export const WALK_SPEED = 3;
export const RUN_SPEED = 6;
export const WORLD_LIMIT = GRID_HALF;
export const MAX_PENDING_INPUTS = 32;
export const JUMP_HEIGHT = 45.5;
// Airtime is the feel parameter, not an Earth-gravity consequence. The avatar is
// 1.35 units tall and the map is ~91 units floor-to-ceiling, so "half the map"
// is already a ~34-body-height leap. At real gravity it would hang in the air for
// six seconds; deriving gravity from a short airtime keeps the arc snappy while
// the apex stays exactly JUMP_HEIGHT.
//   apex    = JUMP_SPEED^2 / (2 * GRAVITY) = JUMP_HEIGHT
//   airtime = 2 * JUMP_SPEED / GRAVITY     = JUMP_AIRTIME
export const JUMP_AIRTIME = 1.2;
export const GRAVITY = 8 * JUMP_HEIGHT / (JUMP_AIRTIME * JUMP_AIRTIME);
export const JUMP_SPEED = 4 * JUMP_HEIGHT / JUMP_AIRTIME;
// Rendering follows height exactly (a jump moves too fast to smooth) and smooths
// only the horizontal plane, where one step is at most RUN_SPEED * TICK_DT.
// Corrections beyond this are spawns or reconnects, not ordinary lag.
export const RENDER_SNAP_DISTANCE = 5;
// The arc is advanced in whole TICK_DT steps, so it lands on a tick boundary
// rather than exactly at JUMP_AIRTIME. Simulate the arc once here, with the same
// integrator stepPlayer uses, and retime the jump clip to the real landing time.
export const AIR_TIME = (() => {
  let y = 0, vy = JUMP_SPEED, ticks = 0;
  do { y += vy * TICK_DT - 0.5 * GRAVITY * TICK_DT * TICK_DT; vy -= GRAVITY * TICK_DT; ticks++; } while (y > 0 && ticks < 1000);
  return ticks * TICK_DT;
})();
export type AnimationName = "Idle" | "Walk" | "Run" | "Jump";
export interface InputMessage { seq: number; forward: number; right: number; run: boolean; jump?: boolean }
export interface Transform { x: number; y: number; z: number; vy: number; rotation: number; currentAnimation: AnimationName }
export interface PlayerSnapshot extends Transform { lastProcessedSeq: number }

export function isInput(value: unknown): value is InputMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Number.isSafeInteger(v.seq) && (v.seq as number) > 0 && (v.seq as number) <= 0xffffffff
    && typeof v.forward === "number" && Number.isFinite(v.forward) && Math.abs(v.forward) <= 1
    && typeof v.right === "number" && Number.isFinite(v.right) && Math.abs(v.right) <= 1
    && typeof v.run === "boolean"
    && (v.jump === undefined || typeof v.jump === "boolean");
}

/**
 * Advances one 50 ms step: horizontal movement, then vertical motion.
 *
 * Horizontal collision is the existing 2D walkability mask, so a jump is purely
 * visual — it cannot clear a blocked cell. Vertical motion is independent: the
 * player is either on the board (y = GROUND_Y) or following a ballistic arc.
 */
export function stepPlayer(player: Transform, input: InputMessage, dt = TICK_DT): void {
  const magnitude = Math.hypot(input.right, input.forward);
  if (magnitude > 0) {
    const scale = (input.run ? RUN_SPEED : WALK_SPEED) * dt / Math.max(1, magnitude);
    const next = resolveMove(player.x, player.z, input.right * scale, -input.forward * scale);
    player.x = next.x;
    player.z = next.z;
    player.rotation = Math.atan2(input.right, -input.forward);
  }

  if (player.y <= GROUND_Y && input.jump) {
    // Grounded and asked to jump: leave the board with the takeoff speed, then
    // integrate this step like any other airborne tick.
    player.y = GROUND_Y;
    player.vy = JUMP_SPEED;
  }
  if (player.y > GROUND_Y || player.vy > 0) integrateGravity(player, dt);
  else {
    player.y = GROUND_Y;
    player.vy = 0;
  }

  if (player.y > GROUND_Y) player.currentAnimation = "Jump";
  else if (magnitude > 0) player.currentAnimation = input.run ? "Run" : "Walk";
  else player.currentAnimation = "Idle";
}

/**
 * One airborne step. Position Verlet (`y += v·dt − ½g·dt²`, then `v −= g·dt`)
 * keeps the apex exact regardless of the 50 ms tick, so the tuned JUMP_HEIGHT is
 * what the player actually reaches.
 */
function integrateGravity(player: Transform, dt: number): void {
  player.y += player.vy * dt - 0.5 * GRAVITY * dt * dt;
  player.vy -= GRAVITY * dt;
  if (player.y <= GROUND_Y) { player.y = GROUND_Y; player.vy = 0; }
}

/**
 * Vertical motion alone. Used by the server when a player's input queue is empty:
 * a disconnected or idle client must still fall back to the floor.
 */
export function stepVertical(player: Transform, dt = TICK_DT): void {
  if (player.y <= GROUND_Y && player.vy <= 0) { player.y = GROUND_Y; player.vy = 0; return; }
  integrateGravity(player, dt);
}

export function reconcile(authoritative: PlayerSnapshot, pending: readonly InputMessage[]): PlayerSnapshot {
  const predicted = { ...authoritative };
  for (const input of pending) if (input.seq > authoritative.lastProcessedSeq) stepPlayer(predicted, input);
  return predicted;
}
