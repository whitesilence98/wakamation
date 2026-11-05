"use client";

import { useEffect, useState } from "react";
import { GROUND_Y } from "@game/shared/movement";
import { BELL_TARGET, LANTERN_RANGE } from "@game/shared/bell";
import { useGame } from "@/network/GameProvider";

function useBellClock() {
  const { bell } = useGame();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return bell ? bell.serverNow + Math.max(0, elapsed - bell.receivedAt) : 0;
}

export function BellLanterns() {
  const { bell } = useGame();
  const now = useBellClock();
  if (!bell) return null;
  return <group>{bell.lanterns.map(lantern => {
    const lit = bell.phase === "active" && lantern.litUntil > now;
    return <group key={lantern.id} position={[lantern.x, GROUND_Y, lantern.z]}>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.08, 0.14, 0.9, 8]} />
        <meshStandardMaterial color="#72533c" />
      </mesh>
      <mesh position={[0, 1.15, 0]}>
        <sphereGeometry args={[0.3, 12, 8]} />
        <meshStandardMaterial color={lit ? "#ffcb66" : "#7c8797"} emissive={lit ? "#ffab36" : "#000000"} emissiveIntensity={2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.65, 0.75, 32]} />
        <meshBasicMaterial color={lit ? "#ffcb66" : "#9bb4ce"} />
      </mesh>
    </group>;
  })}</group>;
}

export function BellPanel() {
  const { bell, sessionId, snapshots, profiles, lightLantern } = useGame();
  const now = useBellClock();
  const player = sessionId ? snapshots.current.get(sessionId) : undefined;
  const profile = sessionId ? profiles.get(sessionId) : undefined;
  const nearest = player && bell?.lanterns.filter(l => l.litUntil <= now
    && Math.hypot(l.x - player.x, l.z - player.z) <= LANTERN_RANGE
    && Math.abs(player.y - GROUND_Y) <= 1)
    .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
  const canLight = bell?.phase === "active" && !!nearest;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "KeyE" || event.repeat || event.ctrlKey || event.metaKey || event.altKey
        || target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      if (canLight && nearest) { event.preventDefault(); lightLantern(nearest.id); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canLight, nearest?.id, lightLantern]);
  if (!bell) return null;
  const seconds = Math.max(0, Math.ceil((bell.endsAt - now) / 1000));
  const title = bell.phase === "waiting" ? "The Bell is coming"
    : bell.phase === "countdown" ? "Gather at the lanterns!"
    : bell.phase === "active" ? "Keep the lanterns burning"
    : bell.won ? "The harbor shines!" : "The fog won this round";
  return <section aria-label="The Bell festival" style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
    width: "min(420px, calc(100% - 32px))", boxSizing: "border-box", padding: "14px 18px", borderRadius: 16,
    background: "#122033ee", color: "#fff0d4", border: "1px solid #917449", zIndex: 5 }}>
    <strong>{title}</strong>
    <p style={{ margin: "6px 0", fontSize: 14 }}>{bell.phase === "active"
      ? `${Math.floor(bell.charge)} / ${BELL_TARGET} lantern-seconds · ${seconds}s left`
      : `${seconds}s until ${bell.phase === "waiting" ? "gathering" : bell.phase === "countdown" ? "the round" : "the next cycle"}`}</p>
    <p style={{ margin: "6px 0", fontSize: 13 }}>Work together: each flame lasts 12s. Walk to an unlit lantern; press E to light it.</p>
    <button type="button" disabled={!canLight} onClick={() => nearest && lightLantern(nearest.id)}
      style={{ padding: "8px 14px", cursor: canLight ? "pointer" : "default" }}>Light nearby lantern (E)</button>
    <p style={{ margin: "6px 0 0", fontSize: 12 }}>Embers: {profile?.embers ?? 0} · Your lights: {profile?.lanternsLit ?? 0} · Session only</p>
  </section>;
}
