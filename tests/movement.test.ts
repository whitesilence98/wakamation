import assert from "node:assert/strict";
import { test } from "node:test";
import { canStand, findSpawn, isInput, reconcile, resolveMove, stepPlayer, RUN_SPEED, TICK_DT, WALK_SPEED, WORLD_LIMIT, type PlayerSnapshot } from "@game/shared/movement";

const player = (): PlayerSnapshot => ({ ...findSpawn([]), y: 0, rotation: 0, currentAnimation: "Idle", lastProcessedSeq: 0 });
const input = { seq: 1, forward: 1, right: 0, run: false };
test("walking and running respect normalized speed limits and collision", () => {
  for (const run of [false, true]) {
    const p = player(), start = { ...p };
    stepPlayer(p, { ...input, right: 1, run });
    assert.ok(Math.hypot(p.x - start.x, p.z - start.z) <= (run ? RUN_SPEED : WALK_SPEED) * TICK_DT + 1e-10);
    assert.ok(canStand(p.x, p.z));
    assert.equal(p.currentAnimation, run ? "Run" : "Walk");
  }
});
test("idle, swept bounds and invalid starting positions", () => {
  const p = player();
  for (const [dx, dz] of [[200, 0], [-200, 0], [0, 200], [0, -200], [200, 200]]) {
    const next = resolveMove(p.x, p.z, dx!, dz!);
    assert.ok(canStand(next.x, next.z));
    assert.ok(Math.abs(next.x) < WORLD_LIMIT && Math.abs(next.z) < WORLD_LIMIT);
  }
  assert.equal(canStand(WORLD_LIMIT, 0), false);
  assert.deepEqual(resolveMove(WORLD_LIMIT, 0, 1, 0), { x: WORLD_LIMIT, z: 0 });
  assert.equal(canStand(NaN, 0), false);
  stepPlayer(p, { ...input, forward: 0 });
  assert.equal(p.currentAnimation, "Idle");
});
test("room spawns are clear and separated", () => {
  const taken: { x: number; z: number }[] = [];
  for (let i = 0; i < 32; i++) {
    const spawn = findSpawn(taken);
    assert.ok(canStand(spawn.x, spawn.z));
    assert.ok(taken.every(p => Math.hypot(p.x - spawn.x, p.z - spawn.z) >= 1.2));
    taken.push(spawn);
  }
});
test("input trust boundary rejects malformed, non-finite and oversized values", () => {
  assert.ok(isInput(input));
  for (const value of [null, {}, { ...input, forward: NaN }, { ...input, right: Infinity }, { ...input, seq: 1.5 }, { ...input, seq: 0 }, { ...input, seq: 2 ** 32 }, { ...input, run: "yes" }, { ...input, forward: 2 }]) assert.equal(isInput(value), false);
});
test("reconciliation replays only unacknowledged inputs without mutating truth", () => {
  const truth = player();
  truth.lastProcessedSeq = 1;
  const before = { ...truth };
  const expected = { ...truth };
  stepPlayer(expected, { ...input, seq: 2 });
  const result = reconcile(truth, [input, { ...input, seq: 2 }]);
  assert.deepEqual(result, expected);
  assert.deepEqual(truth, before);
});
