// Render-only partition: preserve placement references, including duplicates.
export function forestChunks<T extends { x: number; z: number }>(placements: readonly T[]): T[][] {
  const chunks = new Map<string, T[]>();
  for (const placement of placements) {
    const key = `${Math.floor(placement.x / 12)},${Math.floor(placement.z / 12)}`;
    const chunk = chunks.get(key);
    if (chunk) chunk.push(placement);
    else chunks.set(key, [placement]);
  }
  return [...chunks.values()];
}
