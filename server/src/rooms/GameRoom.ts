import { randomUUID } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import { GameState, GROUND_Y, Player, TICK_DT, TICK_MS, MAX_PENDING_INPUTS, findSpawn, isInput, stepPlayer, stepVertical, type InputMessage } from "@game/shared";
import { advanceBell, bellReward, BELL_WAIT_MS, LanternState, lightLantern } from "@game/shared";
import { isRecord, isVoiceSignal, normalizeColor, normalizeName, pairVoicePeers, speakingExpired, VOICE_ENTER_RANGE, type VoiceEdge } from "@game/shared/social";

type Inbox = { inputs: InputMessage[]; lastSeq: number; windowStart: number; count: number };
type Social = { enabled: boolean; activeAt: number; limits: Map<string, { tokens: number; at: number }>; peers: string };

export class GameRoom extends Room<GameState> {
  maxClients = 32;
  private inboxes = new Map<string, Inbox>();
  private social = new Map<string, Social>();
  private edges: VoiceEdge[] = [];
  private voiceTick = 0;

  private allow(id: string, key: string, rate: number, capacity = rate): boolean {
    const social = this.social.get(id);
    if (!social) return false;
    const now = Date.now(), bucket = social.limits.get(key) ?? { tokens: capacity, at: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.at) * rate / 1000);
    bucket.at = now;
    social.limits.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  }

  private updateVoice() {
    const positions = [...this.state.players].filter(([id]) => this.social.get(id)?.enabled).map(([id, p]) => ({ id, x: p.x, z: p.z }));
    this.edges = pairVoicePeers(positions, this.edges, randomUUID);
    for (const client of this.clients) {
      const social = this.social.get(client.sessionId);
      if (!social) continue;
      const peers = this.edges.filter(e => e.a === client.sessionId || e.b === client.sessionId)
        .map(e => ({ id: e.a === client.sessionId ? e.b : e.a, token: e.token }));
      const own = this.state.players.get(client.sessionId);
      const limited = !!(social.enabled && own && positions.some(p => p.id !== client.sessionId
        && Math.hypot(p.x - own.x, p.z - own.z) <= VOICE_ENTER_RANGE && !peers.some(peer => peer.id === p.id)));
      const payload = { peers, limited }, encoded = JSON.stringify(payload);
      if (encoded !== social.peers) { social.peers = encoded; client.send("voice-peers", payload); }
    }
  }

  private tickBell(now: number) {
    const previous = this.state.bell.phase;
    if (advanceBell(this.state.bell, now)) {
      for (const player of this.state.players.values()) {
        player.embers += bellReward(player.lanternsLit, this.state.bell.won);
      }
    }
    if (previous !== "active" && this.state.bell.phase === "active") {
      for (const player of this.state.players.values()) player.lanternsLit = 0;
    }
  }

  onCreate() {
    this.state = new GameState();
    this.state.bell.updatedAt = Date.now();
    this.state.bell.endsAt = Date.now() + BELL_WAIT_MS;
    const spots: { x: number; z: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const spot = findSpawn(spots, i, 6);
      spots.push(spot);
      const lantern = new LanternState();
      lantern.id = `lantern-${i + 1}`;
      lantern.x = spot.x;
      lantern.z = spot.z;
      this.state.bell.lanterns.push(lantern);
    }
    this.onMessage("light-lantern", (client, value: unknown) => {
      if (typeof value !== "string" || value.length > 32 || !this.allow(client.sessionId, "lantern", 4, 4)) return;
      const player = this.state.players.get(client.sessionId);
      const lantern = this.state.bell.lanterns.find(l => l.id === value);
      const now = Date.now();
      // Account for elapsed charge before changing a lantern's expiry.
      this.tickBell(now);
      if (player && lantern && lightLantern(this.state.bell, lantern, player, now)) player.lanternsLit++;
    });
    this.patchRate = TICK_MS;
    this.onMessage("rename", (client, value: unknown) => {
      if (!this.allow(client.sessionId, "rename", 1, 1)) return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.name = normalizeName(value);
    });
    this.onMessage("recolor", (client, value: unknown) => {
      if (!this.allow(client.sessionId, "recolor", 1, 1)) return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.color = normalizeColor(value);
    });
    this.onMessage("voice-enabled", (client, value: unknown) => {
      const social = this.social.get(client.sessionId), player = this.state.players.get(client.sessionId);
      if (typeof value !== "boolean" || !social || !player || social.enabled === value) return;
      // Always accept disabling so rate limits cannot leave a microphone session active.
      if (value && !this.allow(client.sessionId, "enable", 2, 2)) {
        client.send("voice-error", "Voice enabled too frequently. Wait a moment, then enable voice again.");
        return;
      }
      social.enabled = value;
      player.speaking = false;
      social.activeAt = 0;
      this.updateVoice();
    });
    this.onMessage("voice-speaking", (client, value: unknown) => {
      if (typeof value !== "boolean" || !this.allow(client.sessionId, "speaking", 10, 10)) return;
      const social = this.social.get(client.sessionId), player = this.state.players.get(client.sessionId);
      if (!social || !player) return;
      player.speaking = social.enabled && value;
      social.activeAt = player.speaking ? Date.now() : 0;
    });
    this.onMessage("voice-signal", (client, value: unknown) => {
      if (!this.allow(client.sessionId, "signal", 30, 60) || !isVoiceSignal(value)) return;
      if (!this.social.get(client.sessionId)?.enabled || !this.social.get(value.to)?.enabled) return;
      const pair = this.edges.find(e => e.token === value.token && (e.a === client.sessionId && e.b === value.to || e.b === client.sessionId && e.a === value.to));
      const a = this.state.players.get(client.sessionId), b = this.state.players.get(value.to);
      if (!pair || !a || !b || Math.hypot(a.x - b.x, a.z - b.z) >= 15) return;
      const target = this.clients.find(c => c.sessionId === value.to);
      const base = { from: client.sessionId, to: value.to, token: value.token };
      target?.send("voice-signal", value.kind === "ice" ? { ...base, kind: "ice", candidate: value.candidate === null ? null : {
        candidate: value.candidate.candidate, sdpMid: value.candidate.sdpMid, sdpMLineIndex: value.candidate.sdpMLineIndex,
        ...(value.candidate.usernameFragment === undefined ? {} : { usernameFragment: value.candidate.usernameFragment }),
      } } : { ...base, kind: value.kind, sdp: value.sdp });
    });
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
      this.tickBell(Date.now());
      for (const [id, player] of this.state.players) {
        const input = this.inboxes.get(id)?.inputs.shift();
        if (input) { stepPlayer(player, input, TICK_DT); player.lastProcessedSeq = input.seq; }
        else {
          // No input this tick: still resolve an in-flight jump so an idle or
          // disconnected client lands instead of hanging in the air.
          stepVertical(player, TICK_DT);
          if (player.y <= GROUND_Y) player.currentAnimation = "Idle";
        }
        if (player.speaking && speakingExpired(this.social.get(id)?.activeAt ?? 0, Date.now())) player.speaking = false;
      }
      if (++this.voiceTick % 4 === 0) this.updateVoice();
    }, TICK_MS);
  }

  onJoin(client: Client, options: unknown) {
    const player = new Player();
    player.name = normalizeName(isRecord(options) ? options.name : undefined);
    player.color = normalizeColor(isRecord(options) ? options.color : undefined);
    try {
      const spawn = findSpawn([...this.state.players.values()]);
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
    } catch { client.leave(4009, "No clear map spawn available"); return; }
    this.state.players.set(client.sessionId, player);
    this.inboxes.set(client.sessionId, { inputs: [], lastSeq: 0, windowStart: Date.now(), count: 0 });
    this.social.set(client.sessionId, { enabled: false, activeAt: 0, limits: new Map(), peers: "" });
  }

  onLeave(client: Client) {
    this.inboxes.delete(client.sessionId);
    this.social.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.updateVoice();
  }

  onDispose() { this.inboxes.clear(); this.social.clear(); this.edges = []; }
}
