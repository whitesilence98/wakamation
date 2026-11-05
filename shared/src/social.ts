export const DEFAULT_COLOR = "";
export const normalizeColor = (value: unknown): string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
export const DEFAULT_NAME = "Gaylord";
export const VOICE_ENTER_RANGE = 12;
export const VOICE_EXIT_RANGE = 15;
export const MAX_VOICE_PEERS = 6;
export const SPEAKING_TIMEOUT = 800;
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function normalizeName(value: unknown): string {
  if (typeof value !== "string" || value.length > 256) return DEFAULT_NAME;
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, "").replace(/\s+/gu, " ").trim();
  return Array.from(clean).slice(0, 24).join("") || DEFAULT_NAME;
}

export type VoicePeer = { id: string; token: string };
export type VoicePeers = { peers: VoicePeer[]; limited: boolean };
export type IceCandidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment?: string | null };
export type VoiceSignal = { to: string; token: string } & (
  { kind: "offer" | "answer"; sdp: string } | { kind: "ice"; candidate: IceCandidate | null }
);
export type IncomingVoiceSignal = VoiceSignal & { from: string };
const short = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export function isVoiceSignal(value: unknown): value is VoiceSignal {
  if (!isRecord(value) || !short(value.to, 64) || !short(value.token, 64)) return false;
  if (value.kind === "offer" || value.kind === "answer") return short(value.sdp, 16384);
  if (value.kind !== "ice") return false;
  const c = value.candidate;
  return c === null || (isRecord(c) && typeof c.candidate === "string" && c.candidate.length <= 1024
    && (c.sdpMid === null || typeof c.sdpMid === "string" && c.sdpMid.length <= 64)
    && (c.sdpMLineIndex === null || Number.isInteger(c.sdpMLineIndex) && (c.sdpMLineIndex as number) >= 0 && (c.sdpMLineIndex as number) <= 16)
    && (c.usernameFragment === undefined || c.usernameFragment === null || typeof c.usernameFragment === "string" && c.usernameFragment.length <= 256));
}
export function isVoicePeers(value: unknown): value is VoicePeers {
  return isRecord(value) && typeof value.limited === "boolean" && Array.isArray(value.peers) && value.peers.length <= MAX_VOICE_PEERS
    && value.peers.every(p => isRecord(p) && short(p.id, 64) && short(p.token, 64))
    && new Set(value.peers.map(p => p.id)).size === value.peers.length;
}

export type VoicePosition = { id: string; x: number; z: number };
export type VoiceEdge = { a: string; b: string; token: string };
export function pairVoicePeers(players: readonly VoicePosition[], previous: readonly VoiceEdge[], token: () => string): VoiceEdge[] {
  const byId = new Map(players.map(p => [p.id, p]));
  const degree = new Map(players.map(p => [p.id, 0]));
  const edges: VoiceEdge[] = [];
  const distance = (a: VoicePosition, b: VoicePosition) => Math.hypot(a.x - b.x, a.z - b.z);
  const add = (edge: VoiceEdge) => {
    if (degree.get(edge.a)! >= MAX_VOICE_PEERS || degree.get(edge.b)! >= MAX_VOICE_PEERS) return;
    edges.push(edge);
    degree.set(edge.a, degree.get(edge.a)! + 1);
    degree.set(edge.b, degree.get(edge.b)! + 1);
  };
  for (const edge of previous) {
    const a = byId.get(edge.a), b = byId.get(edge.b);
    if (a && b && distance(a, b) < VOICE_EXIT_RANGE) add(edge);
  }
  const candidates: { a: string; b: string; distance: number }[] = [];
  const sorted = [...players].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i]!, b = sorted[j]!, d = distance(a, b);
    if (d <= VOICE_ENTER_RANGE && !edges.some(e => e.a === a.id && e.b === b.id)) candidates.push({ a: a.id, b: b.id, distance: d });
  }
  candidates.sort((a, b) => a.distance - b.distance || (a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : a.b > b.b ? 1 : 0));
  for (const pair of candidates) {
    if (degree.get(pair.a)! < MAX_VOICE_PEERS && degree.get(pair.b)! < MAX_VOICE_PEERS) add({ a: pair.a, b: pair.b, token: token() });
  }
  return edges;
}
export const speakingExpired = (lastActive: number, now: number) => now - lastActive >= SPEAKING_TIMEOUT;
