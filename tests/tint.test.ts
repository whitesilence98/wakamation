import assert from "node:assert/strict";
import { test } from "node:test";
import { hueForColor, hueForId } from "../client/src/components/character-tint.js";

test("selected hue overrides session default", () => {
  assert.equal(hueForColor(undefined, "player"), hueForId("player"));
  assert.equal(hueForColor("invalid", "player"), hueForId("player"));
  assert.equal(hueForColor("#ff0000", "player"), 0);
  assert.ok(Math.abs(hueForColor("#00ff00", "player") - Math.PI * 2 / 3) < 1e-10);
});

const ids = [
  "aBcDeFgHiJkLmNoPqRsTuVwX",
  "AAAAAAAAAAAAAAAAAAAAAAAA",
  "ZZZZZZZZZZZZZZZZZZZZZZZZ",
  "0123456789abcdef01234567",
  "sess-ion-with-dashes-1234",
  "",
];

test("hue is stable for the same id", () => {
  for (const id of ids) assert.equal(hueForId(id), hueForId(id));
});

test("hue stays in [0, 2π)", () => {
  for (const id of ids) {
    const hue = hueForId(id);
    assert.ok(Number.isFinite(hue), `${id} produced ${hue}`);
    assert.ok(hue >= 0 && hue < Math.PI * 2, `${id} produced ${hue}`);
  }
});

test("different ids spread across the hue circle", () => {
  const hues = ids.slice(0, 5).map(hueForId);
  // Distinct values, and not all clustered in one quadrant.
  assert.equal(new Set(hues).size, hues.length);
  const quadrants = new Set(hues.map(hue => Math.floor(hue / (Math.PI / 2))));
  assert.ok(quadrants.size >= 3, `only ${quadrants.size} quadrants covered: ${hues.join(", ")}`);
});
