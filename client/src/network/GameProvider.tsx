"use client";

import { Client, type Room } from "colyseus.js";
import type { GameState } from "@game/shared";
import type { InputMessage, PlayerSnapshot } from "@game/shared/movement";
import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";

type ConnectionStatus = "connecting" | "connected" | "reconnecting";
type Network = {
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
  const room = useRef<Room<GameState> | null>(null);
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
      snapshots.current.clear();
      revision.current++;
      setPlayerIds([]);
      setSessionId(null);
    };
    const connect = async () => {
      try {
        const joined = await client.joinOrCreate<GameState>("game");
        if (disposed) { void joined.leave(); return; }
        room.current = joined;
        attempts = 0;
        setSessionId(joined.sessionId);
        setStatus("connected");
        setError(null);
        // No per-tick React state: membership changes render; transforms live in refs.
        joined.onStateChange((state) => {
          if (disposed || room.current !== joined) return;
          const next = new Map<string, PlayerSnapshot>();
          state.players.forEach((p, id) => next.set(id, {
            x: p.x, y: p.y, z: p.z, rotation: p.rotation,
            currentAnimation: p.currentAnimation, lastProcessedSeq: p.lastProcessedSeq,
          }));
          snapshots.current = next;
          revision.current++;
          const ids = [...next.keys()];
          setPlayerIds(previous => previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids);
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
  return <GameContext.Provider value={{ room, snapshots, revision, playerIds, sessionId, status, error, sendInput }}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error("useGame must be used inside GameProvider");
  return context;
}
