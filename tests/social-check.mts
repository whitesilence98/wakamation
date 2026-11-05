import assert from "node:assert/strict";
import { DEFAULT_NAME, MAX_VOICE_PEERS, isVoiceSignal, normalizeColor, normalizeName, pairVoicePeers, speakingExpired } from "../shared/src/social.ts";

assert.equal(normalizeColor("#AbC123"), "#abc123");
for (const color of [null, 42, "red", "#abc", "#zzzzzz", "#1234567", ""]) assert.equal(normalizeColor(color), "");
assert.equal(normalizeName(undefined), DEFAULT_NAME);
assert.equal(normalizeName("   "), DEFAULT_NAME);
assert.equal(normalizeName(" Alice\u0000   Smith "), "Alice Smith");
assert.equal(Array.from(normalizeName("😀".repeat(50))).length, 24);
assert.equal(normalizeName("x".repeat(257)), DEFAULT_NAME);
const offer = { to: "peer", token: "pair", kind: "offer", sdp: "v=0\r\n" };
assert.ok(isVoiceSignal(offer));
for (const value of [null, {}, { ...offer, sdp: "x".repeat(16385) }, { ...offer, to: 42 }, { ...offer, kind: "video" },
  { ...offer, kind: "ice", candidate: { candidate: "x", sdpMid: null, sdpMLineIndex: -1 } }]) assert.equal(isVoiceSignal(value), false);
let sequence = 0;
const token = () => String(++sequence);
const positions = Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: 0, z: 0 }));
const edges = pairVoicePeers(positions, [], token);
for (const player of positions) {
  const adjacent = edges.filter(e => e.a === player.id || e.b === player.id);
  assert.ok(adjacent.length <= MAX_VOICE_PEERS);
  for (const edge of adjacent) assert.ok(positions.some(p => p.id === edge.a) && positions.some(p => p.id === edge.b));
}
assert.equal(new Set(edges.map(e => `${e.a}:${e.b}`)).size, edges.length);
assert.equal(new Set(edges.map(e => e.token)).size, edges.length);
const pair = [{ id: "a", x: 0, z: 0 }, { id: "b", x: 11, z: 0 }];
const connected = pairVoicePeers(pair, [], token);
assert.equal(connected.length, 1);
pair[1]!.x = 14;
assert.equal(pairVoicePeers(pair, connected, token)[0]!.token, connected[0]!.token);
assert.equal(pairVoicePeers(pair, [], token).length, 0);
pair[1]!.x = 16;
assert.equal(pairVoicePeers(pair, connected, token).length, 0);
assert.equal(speakingExpired(1000, 1799), false);
assert.equal(speakingExpired(1000, 1800), true);
console.log("Social validation checks passed");
