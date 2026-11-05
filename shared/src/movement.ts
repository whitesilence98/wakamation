import { GRID_HALF } from "./collision-data.js";
import { resolveMove } from "./collision.js";
export { canStand, findSpawn, PLAYER_RADIUS, resolveMove } from "./collision.js";

export const TICK_MS = 50;
export const TICK_DT = TICK_MS / 1000;
export const WALK_SPEED = 3;
export const RUN_SPEED = 6;
export const WORLD_LIMIT = GRID_HALF;
export const MAX_PENDING_INPUTS = 32;
export type AnimationName = "Idle" | "Walk" | "Run";
export interface InputMessage { seq: number; forward: number; right: number; run: boolean }
export interface Transform { x: number; y: number; z: number; rotation: number; currentAnimation: AnimationName }
export interface PlayerSnapshot extends Transform { lastProcessedSeq: number }

export function isInput(value: unknown): value is InputMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Number.isSafeInteger(v.seq) && (v.seq as number) > 0 && (v.seq as number) <= 0xffffffff
    && typeof v.forward === "number" && Number.isFinite(v.forward) && Math.abs(v.forward) <= 1
    && typeof v.right === "number" && Number.isFinite(v.right) && Math.abs(v.right) <= 1
    && typeof v.run === "boolean";
}

export function stepPlayer(player: Transform, input: InputMessage, dt = TICK_DT): void {
  const magnitude = Math.hypot(input.right, input.forward);
  if (magnitude === 0) { player.currentAnimation = "Idle"; return; }
  const scale = (input.run ? RUN_SPEED : WALK_SPEED) * dt / Math.max(1, magnitude);
  const next = resolveMove(player.x, player.z, input.right * scale, -input.forward * scale);
  player.x = next.x;
  player.z = next.z;
  player.rotation = Math.atan2(input.right, -input.forward);
  player.currentAnimation = input.run ? "Run" : "Walk";
}

export function reconcile(authoritative: PlayerSnapshot, pending: readonly InputMessage[]): PlayerSnapshot {
  const predicted = { ...authoritative };
  for (const input of pending) if (input.seq > authoritative.lastProcessedSeq) stepPlayer(predicted, input);
  return predicted;
}
