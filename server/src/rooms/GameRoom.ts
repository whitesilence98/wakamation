import { Room, type Client } from "@colyseus/core";
import { GameState, Player, TICK_DT, TICK_MS, MAX_PENDING_INPUTS, findSpawn, isInput, stepPlayer, type InputMessage } from "@game/shared";

type Inbox = { inputs: InputMessage[]; lastSeq: number; windowStart: number; count: number };

export class GameRoom extends Room<GameState> {
  maxClients = 32;
  private inboxes = new Map<string, Inbox>();

  onCreate() {
    this.state = new GameState();
    this.patchRate = TICK_MS;
    this.onMessage("input", (client, message: unknown) => {
      const inbox = this.inboxes.get(client.sessionId);
      if (!inbox) return;
      const now = Date.now();
      if (now - inbox.windowStart >= 1000) { inbox.windowStart = now; inbox.count = 0; }
      if (++inbox.count > 60) { client.leave(4008, "Input rate exceeded"); return; }
      if (!isInput(message) || message.seq <= inbox.lastSeq || message.seq > inbox.lastSeq + MAX_PENDING_INPUTS) return;
      if (inbox.inputs.length >= MAX_PENDING_INPUTS) { client.leave(4008, "Input backlog exceeded"); return; }
      inbox.lastSeq = message.seq;
      inbox.inputs.push(message);
    });
    this.setSimulationInterval(() => {
      for (const [id, player] of this.state.players) {
        const input = this.inboxes.get(id)?.inputs.shift();
        if (input) {
          stepPlayer(player, input, TICK_DT);
          player.lastProcessedSeq = input.seq;
        } else player.currentAnimation = "Idle";
      }
    }, TICK_MS);
  }

  onJoin(client: Client) {
    const player = new Player();
    try {
      const spawn = findSpawn([...this.state.players.values()]);
      player.x = spawn.x;
      player.z = spawn.z;
    } catch {
      client.leave(4009, "No clear map spawn available");
      return;
    }
    this.state.players.set(client.sessionId, player);
    this.inboxes.set(client.sessionId, { inputs: [], lastSeq: 0, windowStart: Date.now(), count: 0 });
  }

  onLeave(client: Client) {
    this.inboxes.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose() { this.inboxes.clear(); }
}
