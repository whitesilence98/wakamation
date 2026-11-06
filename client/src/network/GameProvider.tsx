"use client";

import { Client, type Room } from "colyseus.js";
import type { GameState } from "@game/shared";
import type { BellPhase, Lantern } from "@game/shared/bell";
import type { InputMessage, PlayerSnapshot } from "@game/shared/movement";
import { DEFAULT_CHARACTER, DEFAULT_COLOR, DEFAULT_NAME, isCharacter, normalizeColor, normalizeName, type CharacterId } from "@game/shared/social";
import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";

type ConnectionStatus = "connecting" | "connected" | "reconnecting";
type Profile = { name: string; color: string; character: CharacterId; speaking: boolean; embers: number; lanternsLit: number };
type BellSnapshot = { phase: BellPhase; endsAt: number; serverNow: number; receivedAt: number; charge: number; won: boolean; lanterns: Lantern[] };
type Network = {
  bell: BellSnapshot | null;
  lightLantern: (id: string) => void;
  activeRoom: Room<GameState> | null;
  profiles: Map<string, Profile>;
  rename: (name: string) => boolean;
  recolor: (color: string) => boolean;
  selectCharacter: (character: CharacterId) => boolean;
  characterError: string | null;
  room: MutableRefObject<Room<GameState> | null>;
  snapshots: MutableRefObject<Map<string, PlayerSnapshot>>;
  revision: MutableRefObject<number>;
  playerIds: string[];
  sessionId: string | null;
  status: ConnectionStatus;
  error: string | null;
  sendInput: (input: InputMessage) => boolean;
};
const GameContext = createContext<Network | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [bell, setBell] = useState<BellSnapshot | null>(null);
  const room = useRef<Room<GameState> | null>(null);
  const [activeRoom, setActiveRoom] = useState<Room<GameState> | null>(null);
  const [profiles, setProfiles] = useState(new Map<string, Profile>());
  const chosenName = useRef(DEFAULT_NAME);
  const chosenColor = useRef(DEFAULT_COLOR);
  const chosenCharacter = useRef<CharacterId>(DEFAULT_CHARACTER);
  const [characterError, setCharacterError] = useState<string | null>(null);
  const snapshots = useRef(new Map<string, PlayerSnapshot>());
  const revision = useRef(0);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const endpoint = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
    const client = new Client(endpoint);
    const schedule = () => {
      if (disposed) return;
      setStatus("reconnecting");
      retry = setTimeout(() => { void connect(); }, Math.min(1000 * 2 ** attempts++, 10_000));
    };
    const clear = () => {
      room.current = null;
      setActiveRoom(null);
      setBell(null);
      setProfiles(new Map());
      setCharacterError(null);
      snapshots.current.clear();
      revision.current++;
      setPlayerIds([]);
      setSessionId(null);
    };
    const connect = async () => {
      try {
        const joined = await client.joinOrCreate<GameState>("game", { name: chosenName.current, color: chosenColor.current, character: chosenCharacter.current });
        if (disposed) { void joined.leave(); return; }
        room.current = joined;
        setActiveRoom(joined);
        attempts = 0;
        setSessionId(joined.sessionId);
        setStatus("connected");
        setError(null);
        // No per-tick React state: membership changes render; transforms live in refs.
        joined.onStateChange((state) => {
          if (disposed || room.current !== joined) return;
          setBell({ phase: state.bell.phase, endsAt: state.bell.endsAt, serverNow: state.bell.updatedAt,
            receivedAt: performance.now(), charge: state.bell.charge, won: state.bell.won,
            lanterns: Array.from(state.bell.lanterns, l => ({ id: l.id, x: l.x, z: l.z, litUntil: l.litUntil })) });
          const next = new Map<string, PlayerSnapshot>();
          state.players.forEach((p, id) => next.set(id, {
            x: p.x, y: p.y, z: p.z, vy: p.vy, rotation: p.rotation,
            currentAnimation: p.currentAnimation, lastProcessedSeq: p.lastProcessedSeq,
          }));
          const metadata = new Map<string, Profile>();
          state.players.forEach((p, id) => metadata.set(id, { name: p.name || DEFAULT_NAME, color: normalizeColor(p.color), character: isCharacter(p.character) ? p.character : DEFAULT_CHARACTER, speaking: p.speaking === true, embers: p.embers, lanternsLit: p.lanternsLit }));
          const ownProfile = metadata.get(joined.sessionId);
          if (ownProfile) chosenCharacter.current = ownProfile.character;
          setProfiles(previous => previous.size === metadata.size && [...metadata].every(([id, p]) => {
            const old = previous.get(id);
            return old?.name === p.name && old.color === p.color && old.character === p.character && old.speaking === p.speaking
              && old.embers === p.embers && old.lanternsLit === p.lanternsLit;
          }) ? previous : metadata);
          snapshots.current = next;
          revision.current++;
          const ids = [...next.keys()];
          setPlayerIds(previous => previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids);
        });
        joined.onMessage("character-error", (message: unknown) => {
          if (!disposed && room.current === joined && typeof message === "string") setCharacterError(message);
        });
        joined.onError((code, message) => {
          if (!disposed && room.current === joined) setError(`${code}: ${message ?? "Connection error"}`);
        });
        joined.onLeave((code) => {
          if (disposed || room.current !== joined) return;
          clear();
          setError(`Disconnected (${code}). Rejoining with a new session.`);
          schedule();
        });
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "Unable to reach game server");
        schedule();
      }
    };
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      const joined = room.current;
      room.current = null;
      snapshots.current.clear();
      if (joined) void joined.leave().catch(() => {});
    };
  }, []);

  const sendInput = (input: InputMessage) => {
    const active = room.current;
    if (!active?.connection.isOpen) return false;
    active.send("input", input);
    return true;
  };
  const rename = (name: string) => {
    const active = room.current;
    if (!active?.connection.isOpen) return false;
    chosenName.current = normalizeName(name);
    active.send("rename", chosenName.current);
    return true;
  };
  const recolor = (color: string) => {
    const active = room.current;
    if (!active?.connection.isOpen) return false;
    chosenColor.current = normalizeColor(color);
    active.send("recolor", chosenColor.current);
    return true;
  };
  const selectCharacter = (character: CharacterId) => {
    const active = room.current;
    if (!active?.connection.isOpen || !isCharacter(character)) return false;
    setCharacterError(null);
    active.send("character", character);
    return true;
  };
  const lightLantern = (id: string) => {
    if (room.current?.connection.isOpen) room.current.send("light-lantern", id);
  };
  return <GameContext.Provider value={{ bell, lightLantern, activeRoom, profiles, rename, recolor, selectCharacter, characterError, room, snapshots, revision, playerIds, sessionId, status, error, sendInput }}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error("useGame must be used inside GameProvider");
  return context;
}
