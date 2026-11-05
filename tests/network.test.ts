import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, type Room } from "colyseus.js";
import type { GameState } from "@game/shared";

async function until(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for synchronized state");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test("two clients: joins, authoritative movement, rejection, leave", async () => {
  const client = new Client("ws://localhost:2567");
  const rooms: Room<GameState>[] = [];
  try {
    const a = await client.joinOrCreate<GameState>("game"); rooms.push(a);
    const b = await client.joinById<GameState>(a.roomId); rooms.push(b);
    await until(() => Boolean(a.state.players?.has(b.sessionId) && b.state.players?.has(a.sessionId)));
    const before = a.state.players.get(a.sessionId)!.x;
    a.send("input", { seq: 1, forward: 0, right: 1, run: false });
    await until(() => b.state.players.get(a.sessionId)?.lastProcessedSeq === 1);
    assert.ok(Math.abs(b.state.players.get(a.sessionId)!.x - before - 0.15) < 0.001);
    a.send("input", { seq: 2, forward: 0, right: 1000, run: false });
    // Out-of-range input cannot move the authoritative player.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(b.state.players.get(a.sessionId)!.lastProcessedSeq, 1);
    assert.ok(Math.abs(b.state.players.get(a.sessionId)!.x - before - 0.15) < 0.001);
    // A burst is not processed faster than one movement step per tick.
    for (let seq = 2; seq <= 6; seq++) a.send("input", { seq, forward: 0, right: 1, run: false });
    await until(() => b.state.players.get(a.sessionId)?.lastProcessedSeq === 6);
    assert.ok(Math.abs(b.state.players.get(a.sessionId)!.x - before - 0.9) < 0.001);
    await b.leave();
    await until(() => !a.state.players.has(b.sessionId));
    const forbidden = await fetch("http://localhost:2567/matchmake/joinOrCreate/game", {
      method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await Promise.allSettled(rooms.filter(room => room.connection.isOpen).map(room => room.leave()));
  }
});
