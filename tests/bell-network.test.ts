import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { BELL_TARGET, type GameState } from "@game/shared";
import { GameRoom } from "../server/src/rooms/GameRoom.js";

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Bell synchronization");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test("Bell synchronizes interactions and pays contributors exactly once", async () => {
  let authority: GameRoom;
  let disabledAuthority: GameRoom;
  class DisabledRoom extends GameRoom {
    onCreate() { super.onCreate(); disabledAuthority = this; }
  }
  class TestRoom extends GameRoom {
    protected bellEnabled = true;
    onCreate() { super.onCreate(); authority = this; }
  }
  const http = createServer();
  const server = new Server({ transport: new WebSocketTransport({ server: http }), greet: false });
  server.define("bell-test", TestRoom);
  server.define("bell-disabled", DisabledRoom);
  const clients: Room<GameState>[] = [];
  try {
    await server.listen(0, "127.0.0.1");
    const address = http.address();
    assert.ok(address && typeof address !== "string");
    const client = new Client(`ws://127.0.0.1:${address.port}`);
    const disabled = await client.joinOrCreate<GameState>("bell-disabled"); clients.push(disabled);
    await until(() => !!disabled.state.players?.has(disabled.sessionId));
    const paused = disabledAuthority!.state.bell;
    assert.equal(paused.lanterns.length, 0);
    assert.equal(paused.endsAt, 0);
    paused.phase = "active";
    paused.endsAt = Date.now() - 1;
    disabled.send("light-lantern", "lantern-1");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(paused.phase, "active", "disabled Bell must not advance");
    const idlePlayer = disabledAuthority!.state.players.get(disabled.sessionId)!;
    assert.equal(idlePlayer.lanternsLit, 0);
    assert.equal(idlePlayer.embers, 0);
    const a = await client.joinOrCreate<GameState>("bell-test"); clients.push(a);
    const b = await client.joinById<GameState>(a.roomId); clients.push(b);
    await until(() => !!b.state.players?.has(a.sessionId));
    assert.equal(a.state.bell.lanterns.length, 4);
    a.send("light-lantern", "lantern-1");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(authority!.state.players.get(a.sessionId)!.lanternsLit, 0);

    const bell = authority!.state.bell;
    bell.phase = "active";
    bell.updatedAt = Date.now();
    bell.endsAt = Date.now() + 90_000;
    const player = authority!.state.players.get(a.sessionId)!;
    player.x = bell.lanterns[0]!.x;
    player.z = bell.lanterns[0]!.z;
    a.send("light-lantern", { id: "lantern-1", score: 9999 });
    a.send("light-lantern", "lantern-4"); // Too far away.
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(player.lanternsLit, 0);
    a.send("light-lantern", "lantern-1");
    a.send("light-lantern", "lantern-1"); // Already lit: no duplicate credit.
    await until(() => b.state.players.get(a.sessionId)?.lanternsLit === 1);
    assert.equal(player.lanternsLit, 1);
    assert.ok(b.state.bell.lanterns[0]!.litUntil > 0);

    bell.charge = BELL_TARGET;
    await until(() => b.state.bell.phase === "results");
    assert.equal(b.state.bell.won, true);
    assert.equal(b.state.players.get(a.sessionId)!.embers, 17);
    assert.equal(b.state.players.get(b.sessionId)!.embers, 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(player.embers, 17);

    bell.phase = "countdown";
    bell.endsAt = Date.now();
    await until(() => b.state.bell.phase === "active");
    assert.equal(player.lanternsLit, 0);
    assert.equal(player.embers, 17);
    assert.equal(bell.lanterns[0]!.litUntil, 0);
  } finally {
    await Promise.allSettled(clients.map(room => room.leave()));
    await server.gracefullyShutdown(false);
  }
});
