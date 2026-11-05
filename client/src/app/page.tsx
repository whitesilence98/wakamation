"use client";

import dynamic from "next/dynamic";
import { GameProvider, useGame } from "@/network/GameProvider";
const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false, loading: () => <p className="loading">Loading arena…</p> });

function Game() {
  const { status, error, playerIds } = useGame();
  return <main>
    <GameScene />
    <section className="hud" aria-label="Game status">
      <h1>Wakamation</h1>
      <p role="status">{status} · {playerIds.length} player{playerIds.length === 1 ? "" : "s"}</p>
      <p>WASD / Arrow keys · Shift to run</p>
      <p>Drag to orbit · Scroll to zoom</p>
      <p className="muted">Open a second tab to test multiplayer.</p>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  </main>;
}

export default function Page() { return <GameProvider><Game /></GameProvider>; }
