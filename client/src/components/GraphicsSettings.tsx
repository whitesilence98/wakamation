"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, graphicsPreset, type GraphicsSettings as Settings } from "./graphics-settings";

export function GraphicsSettings({ open, settings, onChange, onClose }: {
  open: boolean; settings: Settings; onChange: (settings: Settings) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  const preset = graphicsPreset(settings);
  return <dialog ref={dialog} id="graphics-settings" className="graphics-dialog" aria-labelledby="graphics-title" onClose={onClose}>
    <header className="graphics-header">
      <h2 id="graphics-title">Graphics settings</h2>
      <button type="button" className="pill" onClick={() => dialog.current?.close()} aria-label="Close graphics settings">Close</button>
    </header>
    <p className="muted small">Changes apply immediately. Lower settings can improve frame rate.</p>
    <label className="graphics-control">
      <span>Quality preset</span>
      <select autoFocus value={preset} onChange={event => {
        const name = event.target.value as keyof typeof GRAPHICS_PRESETS;
        if (name in GRAPHICS_PRESETS) onChange({ ...GRAPHICS_PRESETS[name] });
      }}>
        {preset === "Custom" && <option value="Custom" disabled>Custom</option>}
        {Object.keys(GRAPHICS_PRESETS).map(name => <option key={name}>{name}</option>)}
      </select>
    </label>
    <label className="graphics-control">
      <span>View distance <output>{settings.viewDistance} units</output></span>
      <input type="range" min={30} max={80} step={1} value={settings.viewDistance}
        onChange={event => onChange({ ...settings, viewDistance: Number(event.target.value) })} />
      <small>Shorter distance draws less distant scenery.</small>
    </label>
    <label className="graphics-control">
      <span>Render resolution</span>
      <select value={settings.resolution} onChange={event => onChange({ ...settings, resolution: event.target.value as Settings["resolution"] })}>
        <option value="performance">Performance · 0.75×</option>
        <option value="standard">Standard · 1×</option>
        <option value="hd">HD · device resolution, up to 2×</option>
      </select>
      <small>HD increases pixel count, not texture detail. It costs more GPU time.</small>
    </label>
    <label className="graphics-control graphics-checkbox">
      <span>Avatar shadows<small>Vegetation shadows stay disabled.</small></span>
      <input type="checkbox" checked={settings.shadows} onChange={event => onChange({ ...settings, shadows: event.target.checked })} />
    </label>
    <label className="graphics-control">
      <span>Decorative foliage</span>
      <select value={settings.foliage} onChange={event => onChange({ ...settings, foliage: Number(event.target.value) as Settings["foliage"] })}>
        <option value={25}>Sparse · 25%</option><option value={50}>Medium · 50%</option><option value={100}>Full · 100%</option>
      </select>
      <small>Grass, bushes, ferns and flowers only. Trees, rocks and collision stay unchanged.</small>
    </label>
    <footer className="graphics-footer">
      <button type="button" className="pill" onClick={() => onChange({ ...DEFAULT_GRAPHICS })}>Reset defaults</button>
      <span className="muted small">Saved on this browser.</span>
    </footer>
  </dialog>;
}
