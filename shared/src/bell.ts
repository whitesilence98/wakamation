import { GROUND_Y } from "./collision.js";

export const BELL_WAIT_MS = 60_000;
export const BELL_COUNTDOWN_MS = 10_000;
export const BELL_ROUND_MS = 90_000;
export const BELL_RESULTS_MS = 15_000;
export const LANTERN_LIT_MS = 12_000;
export const LANTERN_RANGE = 2;
export const BELL_TARGET = 120; // Combined lantern-seconds; four lanterns can contribute at once.
export type BellPhase = "waiting" | "countdown" | "active" | "results";
export type Lantern = { id: string; x: number; z: number; litUntil: number };
export type BellRound = {
  phase: BellPhase; roundId: number; endsAt: number; updatedAt: number;
  charge: number; won: boolean; lanterns: Iterable<Lantern>;
};

// ponytail: one cooperative mode, short prototype cadence; add rotation after playtesting.
export function advanceBell(round: BellRound, now: number): boolean {
  if (now < round.updatedAt) return false;
  if (round.phase === "active") {
    const until = Math.min(now, round.endsAt);
    for (const lantern of round.lanterns) {
      round.charge += Math.max(0, Math.min(until, lantern.litUntil) - round.updatedAt) / 1000;
    }
    round.charge = Math.min(BELL_TARGET, round.charge);
  }
  round.updatedAt = now;
  if (round.phase === "active" && (round.charge >= BELL_TARGET || now >= round.endsAt)) {
    round.won = round.charge >= BELL_TARGET;
    round.phase = "results";
    round.endsAt = now + BELL_RESULTS_MS;
    return true;
  }
  if (now < round.endsAt) return false;
  if (round.phase === "waiting") {
    round.phase = "countdown";
    round.endsAt = now + BELL_COUNTDOWN_MS;
  } else if (round.phase === "countdown") {
    round.phase = "active";
    round.roundId++;
    round.charge = 0;
    round.won = false;
    round.endsAt = now + BELL_ROUND_MS;
    for (const lantern of round.lanterns) lantern.litUntil = 0;
  } else if (round.phase === "results") {
    round.phase = "waiting";
    round.endsAt = now + BELL_WAIT_MS;
  }
  return false;
}

export function lightLantern(round: BellRound, lantern: Lantern, player: { x: number; y: number; z: number }, now: number): boolean {
  if (round.phase !== "active" || now >= round.endsAt || now < round.updatedAt || lantern.litUntil > now
    || !Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(player.z)
    || Math.hypot(player.x - lantern.x, player.z - lantern.z) > LANTERN_RANGE
    || Math.abs(player.y - GROUND_Y) > 1) return false;
  lantern.litUntil = now + LANTERN_LIT_MS;
  return true;
}

export function bellReward(lights: number, won: boolean): number {
  return lights > 0 ? 5 + lights * 2 + (won ? 10 : 0) : 0;
}
