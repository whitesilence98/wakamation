import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceBell, bellReward, BELL_COUNTDOWN_MS, BELL_ROUND_MS, BELL_TARGET, BELL_WAIT_MS,
  LANTERN_LIT_MS, lightLantern, type BellRound } from "../shared/src/bell.js";
import { canStand, findSpawn, GROUND_Y } from "../shared/src/collision.js";

function round(): BellRound {
  return { phase: "waiting", roundId: 0, endsAt: BELL_WAIT_MS, updatedAt: 0,
    charge: 0, won: false, lanterns: [{ id: "one", x: 0, z: 0, litUntil: 0 }] };
}
function active() {
  const state = round();
  advanceBell(state, BELL_WAIT_MS);
  advanceBell(state, BELL_WAIT_MS + BELL_COUNTDOWN_MS);
  return state;
}

test("Bell advances countdown, round, result, next cycle; rewards settle once", () => {
  const state = round();
  advanceBell(state, BELL_WAIT_MS - 1);
  assert.equal(state.phase, "waiting");
  advanceBell(state, BELL_WAIT_MS);
  assert.equal(state.phase, "countdown");
  advanceBell(state, state.endsAt);
  assert.equal(state.phase, "active");
  assert.equal(state.roundId, 1);
  assert.equal(advanceBell(state, state.endsAt), true);
  assert.equal(state.phase, "results");
  assert.equal(state.won, false);
  assert.equal(advanceBell(state, state.updatedAt + 1), false);
  advanceBell(state, state.endsAt);
  assert.equal(state.phase, "waiting");
  advanceBell(state, state.endsAt);
  advanceBell(state, state.endsAt);
  assert.equal(state.roundId, 2);
});

test("light requests enforce phase, range, ground height, expiry, clock, finite coordinates", () => {
  const state = active(), lantern = [...state.lanterns][0]!, now = state.updatedAt;
  const player = { x: 0, y: GROUND_Y, z: 0 };
  assert.equal(lightLantern(state, lantern, { ...player, x: 3 }, now), false);
  assert.equal(lightLantern(state, lantern, { ...player, y: GROUND_Y + 2 }, now), false);
  assert.equal(lightLantern(state, lantern, { ...player, x: NaN }, now), false);
  assert.equal(lightLantern(state, lantern, player, now - 1), false);
  assert.equal(lightLantern(state, lantern, player, now), true);
  assert.equal(lightLantern(state, lantern, player, now), false);
  advanceBell(state, now + LANTERN_LIT_MS);
  assert.equal(state.charge, 12);
  assert.equal(lightLantern(state, lantern, player, now + LANTERN_LIT_MS), true);
  assert.equal(lightLantern(state, lantern, player, state.endsAt), false);
  state.phase = "waiting";
  assert.equal(lightLantern(state, lantern, player, now + LANTERN_LIT_MS), false);
});

test("charge counts elapsed lit time only, ignores reversed clock, caps at round deadline", () => {
  const state = active(), lantern = [...state.lanterns][0]!, start = state.updatedAt;
  assert.equal(lightLantern(state, lantern, { x: 0, y: GROUND_Y, z: 0 }, start), true);
  advanceBell(state, start + 5_000);
  assert.equal(state.charge, 5);
  advanceBell(state, start + 4_000);
  assert.equal(state.charge, 5);
  advanceBell(state, start + 20_000);
  assert.equal(state.charge, 12);
  lantern.litUntil = state.endsAt + 100_000;
  advanceBell(state, state.endsAt + 10_000);
  assert.equal(state.charge, 12 + (BELL_ROUND_MS - 20_000) / 1000);
  assert.equal(state.won, false);
});

test("success caps charge and grants only contributors session rewards", () => {
  const state = active();
  state.charge = BELL_TARGET - 1;
  [...state.lanterns][0]!.litUntil = state.updatedAt + 12_000;
  assert.equal(advanceBell(state, state.updatedAt + 2_000), true);
  assert.equal(state.charge, BELL_TARGET);
  assert.equal(state.won, true);
  assert.equal(bellReward(0, true), 0);
  assert.equal(bellReward(3, true), 21);
  assert.equal(bellReward(3, false), 11);
});

test("prototype lanterns occupy walkable, separated positions", () => {
  const spots: { x: number; z: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const spot = findSpawn(spots, i, 6);
    assert.ok(canStand(spot.x, spot.z));
    assert.ok(spots.every(other => Math.hypot(other.x - spot.x, other.z - spot.z) >= 6));
    spots.push(spot);
  }
});
