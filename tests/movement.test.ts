import assert from "node:assert/strict";
import { test } from "node:test";
import { AIR_TIME, canStand, findSpawn, GROUND_Y, isInput, JUMP_HEIGHT, reconcile, resolveMove, stepPlayer, stepVertical, RUN_SPEED, TICK_DT, WALK_SPEED, WORLD_LIMIT, type PlayerSnapshot } from "@game/shared/movement";
import { CLEARING_RADIUS, createForest, FOREST_ASSETS, FOREST_OBSTACLES, FOREST_PATHS, FOREST_PLACEMENTS } from "@game/shared/forest";

// Prediction and the server share the flat forest floor.
const player = (): PlayerSnapshot => ({ ...findSpawn([]), y: GROUND_Y, vy: 0, rotation: 0, currentAnimation: "Idle", lastProcessedSeq: 0 });
const input = { seq: 1, forward: 1, right: 0, run: false };
test("forest layout is deterministic and its solid props match collision", () => {
  assert.equal(GROUND_Y, 0);
  assert.equal(WORLD_LIMIT, 40);
  assert.deepEqual(createForest(), FOREST_PLACEMENTS);
  assert.ok(FOREST_PLACEMENTS.length > 300 && FOREST_PLACEMENTS.length < 6000);
  const solids = FOREST_OBSTACLES.filter(p => Math.abs(p.x) < 38 && Math.abs(p.z) < 38);
  assert.ok(solids.some(p => p.kind === "Rock_Medium_1"));
  assert.ok(solids.some(p => p.kind === "Pine_1"));
  for (const p of solids) assert.equal(canStand(p.x, p.z), false, `${p.kind} must block its center`);
  assert.ok(FOREST_PLACEMENTS.some(p => !FOREST_ASSETS[p.kind].blocking && canStand(p.x, p.z)), "small foliage is walkable");
  const obstacle = solids.find(p => canStand(p.x - p.radius - 2, p.z));
  assert.ok(obstacle);
  const start = obstacle.x - obstacle.radius - 2;
  const end = resolveMove(start, obstacle.z, obstacle.radius * 2 + 4, 0);
  assert.ok(end.x < obstacle.x && canStand(end.x, end.z), "sweep cannot tunnel through a trunk/rock");
});
test("forest clearing and connected path corridors stay walkable", () => {
  for (let z = -CLEARING_RADIUS; z <= CLEARING_RADIUS; z += 0.5) {
    for (let x = -CLEARING_RADIUS; x <= CLEARING_RADIUS; x += 0.5) {
      if (Math.hypot(x, z) <= CLEARING_RADIUS) assert.ok(canStand(x, z));
    }
  }
  for (const path of FOREST_PATHS) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(length / 0.2);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      for (const offset of [-1, 0, 1]) {
        assert.ok(canStand(a.x + (b.x - a.x) * t - (b.z - a.z) / length * offset,
          a.z + (b.z - a.z) * t + (b.x - a.x) / length * offset), "path corridor must stay clear");
      }
    }
  }
});
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
test("room spawns are clear, separated, and on the forest floor", () => {
  const taken: { x: number; z: number }[] = [];
  for (let i = 0; i < 32; i++) {
    const spawn = findSpawn(taken);
    assert.ok(canStand(spawn.x, spawn.z));
    assert.equal(spawn.y, GROUND_Y);
    assert.ok(taken.every(p => Math.hypot(p.x - spawn.x, p.z - spawn.z) >= 1.2));
    taken.push(spawn);
  }
});
test("jumping reaches the tuned apex, lands, and is ignored mid-air", () => {
  assert.ok(JUMP_HEIGHT >= 0.5 && JUMP_HEIGHT <= 1, "normal hop, below avatar height");
  assert.ok(AIR_TIME >= 0.5 && AIR_TIME <= 0.7, "short, responsive airtime");
  const p = player();
  stepPlayer(p, { ...input, forward: 0, jump: true });
  assert.ok(p.y > GROUND_Y && p.currentAnimation === "Jump");
  // A second takeoff request while airborne must not add velocity.
  const before = p.vy;
  stepPlayer(p, { ...input, forward: 0, jump: true });
  assert.ok(p.vy < before, "gravity only, no second impulse");
  let apex = p.y, ticks = 2;
  // Steering still works in the air: the mask simply ignores height.
  while (p.y > GROUND_Y) {
    stepPlayer(p, { ...input, forward: 1 });
    ticks++;
    if (p.y <= GROUND_Y) break;
    apex = Math.max(apex, p.y);
    assert.equal(p.currentAnimation, "Jump");
  }
  // The apex is measured above the shared forest floor.
  assert.ok(Math.abs(apex - GROUND_Y - JUMP_HEIGHT) < 1e-6, `apex ${apex - GROUND_Y} should be ${JUMP_HEIGHT}`);
  // Landing happens on a tick boundary, which is what AIR_TIME encodes.
  assert.ok(Math.abs(ticks * TICK_DT - AIR_TIME) < 1e-9);
  assert.equal(p.y, GROUND_Y);
  assert.equal(p.vy, 0);
  // Airborne wins over walking; back on the floor the walk state resumes.
  assert.equal(p.currentAnimation, "Walk");
});
test("an airborne player with no queued input still lands", () => {
  // This is the server's empty-queue branch: a hidden tab or a dropped client
  // must fall back to the floor instead of hanging in the air forever.
  const p = player();
  stepPlayer(p, { ...input, forward: 0, jump: true });
  const ticks = Math.round(AIR_TIME / TICK_DT);
  for (let i = 0; i < ticks; i++) stepVertical(p);
  assert.equal(p.y, GROUND_Y);
  assert.equal(p.vy, 0);
});
test("the jump flag is optional and strictly validated", () => {
  assert.ok(isInput(input));
  assert.ok(isInput({ ...input, jump: true }));
  assert.ok(isInput({ ...input, jump: false }));
  for (const jump of ["yes", 1, null, NaN]) assert.equal(isInput({ ...input, jump }), false);
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
