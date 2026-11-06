import assert from "node:assert/strict";
import { forestChunks } from "../client/src/components/forest-chunks.ts";
import { FOREST_ASSETS, FOREST_PLACEMENTS } from "../shared/src/forest.ts";

// Run only when requested: npx tsx tests/forest-chunks-check.mts
const duplicate = FOREST_PLACEMENTS[0]!;
const placements = [...FOREST_PLACEMENTS, duplicate, { ...duplicate, x: -12, z: -0.01 }];
const before = structuredClone(placements);
const chunks = forestChunks(placements);
const flattened = chunks.flat();
const counts = (values: typeof placements) => {
  const counts = new Map<typeof duplicate, number>();
  for (const p of values) counts.set(p, (counts.get(p) ?? 0) + 1);
  return counts;
};
assert.deepEqual(placements, before, "partitioning must not mutate transforms");
assert.deepEqual(counts(flattened), counts(placements), "every reference, including duplicates, appears exactly once per occurrence");
for (const chunk of chunks) {
  const first = chunk[0]!;
  for (const p of chunk) {
    assert.equal(Math.floor(p.x / 12), Math.floor(first.x / 12));
    assert.equal(Math.floor(p.z / 12), Math.floor(first.z / 12));
  }
}
assert.equal(flattened.filter(p => FOREST_ASSETS[p.kind].blocking).length,
  placements.filter(p => FOREST_ASSETS[p.kind].blocking).length, "no solid props dropped");
assert.deepEqual(forestChunks([]), []);
console.log("Forest chunks preserve placements, transforms, duplicates and solid props.");
