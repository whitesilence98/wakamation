"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useVoice } from "@/network/VoiceProvider";

export function VoiceSpatialAudio() {
  const { updateSpatial } = useVoice();
  const elapsed = useRef(0);
  useFrame(({ camera }, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 0.05) return;
    elapsed.current = 0;
    updateSpatial(camera);
  });
  return null;
}
