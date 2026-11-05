"use client";

import { Html } from "@react-three/drei";
import { DEFAULT_NAME } from "@game/shared/social";
import { useGame } from "@/network/GameProvider";
import { CHARACTER_HEIGHT } from "./character-size";

export function PlayerLabel({ id }: { id: string }) {
  const { profiles } = useGame();
  const player = profiles.get(id);
  return <Html center position={[0, CHARACTER_HEIGHT + 0.25, 0]} style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
    <span className="player-label">
      {player?.name || DEFAULT_NAME}
      {player?.speaking && <svg className="speaking-icon" viewBox="0 0 24 24" role="img" aria-label="Speaking">
        <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>}
    </span>
  </Html>;
}
