import { normalizeColor } from "@game/shared/social";
import { Color, type Material, type Mesh, type Object3D, type WebGLProgramParametersWithUniforms } from "three";

const TAU = Math.PI * 2;

type Tinted = Material & { userData: { hueUniform?: { value: number } } };

/**
 * Stable hue for a player, derived from the session id so every client agrees
 * without a server field. FNV-1a keeps it cheap and well spread.
 */
export function hueForId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x100000000) * TAU;
}

export function hueForColor(color: string | undefined, id: string): number {
  const valid = normalizeColor(color);
  if (!valid) return hueForId(id);
  return new Color(valid).getHSL({ h: 0, s: 0, l: 0 }).h * TAU;
}

export const hexForId = (id: string) => `#${tintColor(hueForId(id)).getHexString()}`;

export function setTintHue(root: Object3D, hue: number) {
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const uniform = (material as Tinted).userData.hueUniform;
      if (uniform) uniform.value = hue;
    }
  });
}

/** Saturated colour at the same hue, for the capsule used when the model fails. */
export function tintColor(hue: number): Color {
  return new Color().setHSL(hue / TAU, 0.65, 0.55);
}

/** Same saturation/lightness as tintColor, as a `#rrggbb` string for the hue slider. */
export function hexForHue(degrees: number): string {
  return `#${tintColor(degrees / 360 * TAU).getHexString()}`;
}

/** Hue in whole degrees (0–359) for a player's chosen or derived colour. */
export function hueOf(color: string | undefined, id: string): number {
  return Math.round(hueForColor(color, id) / TAU * 360) % 360;
}

// One shared callback for every avatar: three caches programs by the custom cache
// key below, so all avatars share one compiled program while each material keeps
// its own uniform object. `this` is the material three is compiling.
function tintShader(this: Tinted, shader: WebGLProgramParametersWithUniforms) {
  // Reuse the per-material uniform created in applyTint so later hue changes land.
  shader.uniforms.uHue = this.userData.hueUniform ?? { value: 0 };
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
      uniform float uHue;
      vec3 hueShift(vec3 c, float a) {
        const vec3 k = vec3(0.577350269189626);
        float ca = cos(a), sa = sin(a);
        // max() guards the negative channels a rotation can produce; they would
        // reach the output transfer function's pow() and yield NaN pixels.
        return max(c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca), 0.0);
      }`)
    .replace("#include <map_fragment>", `#include <map_fragment>
      diffuseColor.rgb = hueShift(diffuseColor.rgb, uHue);`)
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      totalEmissiveRadiance = hueShift(totalEmissiveRadiance, uHue);`);
}

/**
 * Gives every mesh in this cloned model its own tinted material. The clone must
 * already be per-avatar: SkeletonUtils.clone shares materials with the cached
 * GLTF scene, so the originals are never mutated.
 */
export function applyTint(root: Object3D, hue: number) {
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const own = Array.isArray(mesh.material) ? mesh.material.map(material => material.clone()) : mesh.material.clone();
    for (const material of Array.isArray(own) ? own : [own]) {
      const tinted = material as Tinted;
      tinted.userData.hueUniform = { value: hue };
      tinted.onBeforeCompile = tintShader;
      tinted.customProgramCacheKey = () => "hue-tint-v1";
    }
    mesh.material = own;
  });
}

/**
 * Releases the per-avatar material clones. Only materials this module created are
 * disposed: an untinted avatar still holds the shared cached material, and
 * disposing that would empty every future avatar.
 */
export function disposeTint(root: Object3D) {
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((material as Tinted).userData.hueUniform) material.dispose();
    }
  });
}
