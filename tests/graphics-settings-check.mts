import assert from "node:assert/strict";
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, graphicsPreset, normalizeGraphics, showForestPlacement } from "../client/src/components/graphics-settings.ts";
import { FOREST_ASSETS, FOREST_PLACEMENTS } from "../shared/src/forest.ts";

// Run only when requested: npx tsx tests/graphics-settings-check.mts
for (const [name, settings] of Object.entries(GRAPHICS_PRESETS)) {
  assert.deepEqual(normalizeGraphics(settings), settings);
  assert.equal(graphicsPreset(settings), name);
}
assert.equal(graphicsPreset(DEFAULT_GRAPHICS), "Low");
for (const invalid of [null, undefined, [], 1, "high", { viewDistance: NaN, resolution: "4k", shadows: "false", foliage: 0 }]) {
  assert.deepEqual(normalizeGraphics(invalid), DEFAULT_GRAPHICS);
}
assert.equal(normalizeGraphics({ viewDistance: Infinity }).viewDistance, DEFAULT_GRAPHICS.viewDistance);
assert.equal(normalizeGraphics({ viewDistance: -100 }).viewDistance, 30);
assert.equal(normalizeGraphics({ viewDistance: 1000 }).viewDistance, 80);
assert.equal(normalizeGraphics({ shadows: false }).shadows, false);
assert.equal(graphicsPreset({ ...DEFAULT_GRAPHICS, foliage: 50 }), "Custom");
const before = structuredClone(FOREST_PLACEMENTS);
let sparse = 0, medium = 0;
for (const placement of FOREST_PLACEMENTS) {
  const a = showForestPlacement(placement, 25), b = showForestPlacement(placement, 50);
  assert.equal(showForestPlacement({ ...placement }, 25), a, "sampling is identity-based");
  assert.ok(!a || b, "sparse is a subset of medium");
  assert.ok(showForestPlacement(placement, 100));
  if (FOREST_ASSETS[placement.kind].blocking) assert.ok(a && b, "solid props always survive");
  else { sparse += Number(a); medium += Number(b); }
}
assert.ok(sparse > 0 && sparse < medium, "density reduces decoration");
assert.deepEqual(FOREST_PLACEMENTS, before, "settings never mutate shared placements");
console.log("Graphics defaults, presets, validation and deterministic foliage sampling verified.");
