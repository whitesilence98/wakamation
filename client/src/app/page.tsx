"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { GameProvider, useGame } from "@/network/GameProvider";
import { VoiceProvider, useVoice } from "@/network/VoiceProvider";
import { DEFAULT_NAME, normalizeName } from "@game/shared/social";
import { hexForHue, hexForId, hueOf } from "@/components/character-tint";

const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false, loading: () => <p className="loading">Loading arena…</p> });

function Game() {
  const { status, error, playerIds, profiles, sessionId, rename, recolor } = useGame();
  const voice = useVoice();
  const currentName = sessionId ? profiles.get(sessionId)?.name : undefined;
  const currentColor = sessionId ? profiles.get(sessionId)?.color : undefined;
  const [name, setName] = useState(DEFAULT_NAME);
  const [saving, setSaving] = useState(false);
  const [color, setColor] = useState("#38bdf8");
  const [hue, setHue] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const sentName = useRef<string | null>(null);
  const profileColor = useRef("");
  // The wire value the server currently holds: "" while a colour is unset.
  const profileWire = useRef("");
  // Mirrors the server's one-recolor-per-second limit locally, so drags queue
  // instead of being silently dropped by the rate limiter.
  const colorQueue = useRef({ pending: null as string | null, until: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const draggingHue = useRef(false);
  // Scheduled flushes call the newest closure, so a reconnect is never stale.
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!currentName) return;
    setName(currentName);
    // Keep the marker only while a send is still unconfirmed; once the profile
    // matches it, an identical value may be sent again later.
    if (sentName.current === currentName) sentName.current = null;
  }, [currentName]);
  useEffect(() => {
    if (!saving) return;
    const timer = setTimeout(() => setSaving(false), 1100);
    return () => clearTimeout(timer);
  }, [saving]);

  const flushColor = () => {
    const queue = colorQueue.current;
    clearTimeout(queue.timer);
    const remaining = queue.until - performance.now();
    if (remaining > 0) { queue.timer = setTimeout(() => flushRef.current(), remaining + 10); return; }
    const wire = queue.pending;
    queue.pending = null;
    // "" is "derive from the session", so it is only a no-op against the same wire value.
    if (wire !== null && wire !== profileWire.current && recolor(wire)) {
      queue.until = performance.now() + 1100;
      queue.timer = setTimeout(() => flushRef.current(), 1110);
      return;
    }
    // Nothing left to send: show what the server actually kept.
    if (!draggingHue.current && sessionId) {
      const committed = profileColor.current || hexForId(sessionId);
      setColor(committed);
      setHue(hueOf(committed, sessionId));
    }
  };
  useEffect(() => { flushRef.current = flushColor; });
  useEffect(() => () => clearTimeout(colorQueue.current.timer), []);

  // The profile is authoritative: reconnects, "Use default" and the server's
  // answer all land here, and it is what the next send is compared against.
  useEffect(() => {
    if (!sessionId) return;
    const committed = currentColor || hexForId(sessionId);
    profileColor.current = committed;
    profileWire.current = currentColor ?? "";
    if (colorQueue.current.pending !== null || draggingHue.current) return;
    setColor(committed);
    setHue(hueOf(committed, sessionId));
  }, [currentColor, sessionId]);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("hud-collapsed");
      if (stored === "1") setCollapsed(true);
      else if (stored === "0") setCollapsed(false);
      else if (window.innerWidth < 640 || window.innerHeight < 700) setCollapsed(true);
    } catch { /* storage can be unavailable in private modes */ }
  }, []);
  const toggleCollapsed = () => setCollapsed(previous => {
    try { sessionStorage.setItem("hud-collapsed", previous ? "0" : "1"); } catch { /* ignore */ }
    return !previous;
  });

  const commitName = () => {
    const next = normalizeName(name);
    setName(next);
    // Enter and blur can both fire for one edit; the profile comparison and the
    // server's rate limit keep the duplicate harmless.
    if (!sessionId || next === (currentName || DEFAULT_NAME)) return;
    if (rename(next)) setSaving(true);
  };
  const previewColor = (value: string) => {
    setColor(value);
    if (sessionId) setHue(hueOf(value, sessionId));
  };
  // `wire` is what goes to the server; `preview` is what to show now (they differ
  // only for "Use default", where the wire value is "" = derived from the session).
  const sendColor = (wire: string, preview: string) => {
    if (status !== "connected") return;
    previewColor(preview);
    // pointerup, keyup and blur can all report one edit; only queue a real change.
    if (wire === colorQueue.current.pending) return;
    if (wire === profileWire.current && colorQueue.current.pending === null) return;
    colorQueue.current.pending = wire;
    flushColor();
  };
  const commitHue = (event: SyntheticEvent<HTMLInputElement>) => {
    const value = hexForHue(Number(event.currentTarget.value));
    sendColor(value, value);
  };
  const commitColor = (value: string) => sendColor(value.toLowerCase(), value.toLowerCase());
  const useDefaultColor = () => { if (sessionId) sendColor("", hexForId(sessionId)); };
  const toggleVoice = () => { if (voice.status === "off") voice.enable(); else voice.disable(); };
  const voiceLabel = voice.status === "enabled" ? "On" : voice.status === "requesting" ? "Requesting" : "Off";
  const voiceLine = voice.status === "enabled"
    ? voice.talking ? "Speaking to nearby players" : voice.held ? "Microphone live" : "Listening · microphone muted"
    : voice.status === "requesting" ? "Waiting for microphone permission" : "Microphone off";

  return <main>
    <GameScene />
    <section className={collapsed ? "hud is-collapsed" : "hud"} aria-label="Game panel">
      <header className="hud-header">
        <div className="hud-brand">
          <h1 className="hud-wordmark">Wakamation</h1>
          <p className="hud-status" role="status">
            <span className="status-dot" data-state={status} />
            {status} · {playerIds.length} player{playerIds.length === 1 ? "" : "s"}
          </p>
        </div>
        <button type="button" className="hud-collapse" aria-expanded={!collapsed} aria-controls="hud-body"
          aria-label={collapsed ? "Expand panel" : "Collapse panel"} onClick={toggleCollapsed}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 15 6-6 6 6" />
          </svg>
        </button>
      </header>
      <div id="hud-body" className="hud-body" hidden={collapsed}>
        <form className="hud-form" onSubmit={event => {
          event.preventDefault();
          commitName();
          (document.activeElement as HTMLElement | null)?.blur();
        }}>
          <label className="field-label" htmlFor="player-name">Player Name</label>
          <div className="field">
            <input id="player-name" value={name} maxLength={96} autoComplete="off" spellCheck={false}
              disabled={status !== "connected"} onChange={event => setName(event.target.value)} onBlur={commitName} />
            <svg className="field-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="8" r="3.6" />
              <path d="M5.4 20a6.6 6.6 0 0 1 13.2 0" />
            </svg>
          </div>
          <span className="field-hint" aria-live="polite">{saving ? "Saved" : ""}</span>
        </form>

        <section className="hud-section">
          <h2 className="section-label">Customization</h2>
          <div className="field-row">
            <span className="field-label">Hue Tint</span>
            <button type="button" className="pill" onClick={useDefaultColor} disabled={status !== "connected"}>Use default</button>
          </div>
          <div className="hue-row">
            <input className="hue-slider" type="range" min={0} max={359} step={1} value={hue} aria-label="Avatar hue"
              disabled={status !== "connected"}
              onChange={event => { const degrees = Number(event.target.value); setHue(degrees); setColor(hexForHue(degrees)); }}
              onPointerDown={() => { draggingHue.current = true; }}
              onPointerUp={event => { draggingHue.current = false; commitHue(event); }}
              onPointerCancel={() => { draggingHue.current = false; }}
              onLostPointerCapture={() => { draggingHue.current = false; }}
              onKeyUp={commitHue} onBlur={event => { draggingHue.current = false; commitHue(event); }} />
            <input className="swatch" type="color" value={color} aria-label="Exact avatar colour"
              disabled={status !== "connected"} onChange={event => commitColor(event.target.value)} />
          </div>
        </section>

        <section className="hud-section">
          <h2 className="section-label">Voice Chat</h2>
          <div className="voice-row">
            <span className="voice-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9.5h3L11 6v12l-4-3.5H4z" />
                <path d="M15 9.2a4 4 0 0 1 0 5.6" />
                <path d="M17.6 6.6a7.2 7.2 0 0 1 0 10.8" />
              </svg>
            </span>
            <span className="voice-name">Voice</span>
            <span className="voice-state">{voiceLabel}</span>
            <button type="button" role="switch" className="toggle" aria-checked={voice.status === "enabled"} aria-label="Voice chat"
              disabled={status !== "connected" && voice.status === "off"} onClick={toggleVoice} />
          </div>
          <p className="voice-status" aria-live="polite">{voiceLine}</p>
          {voice.status === "enabled" && <button type="button" className="talk-button" aria-pressed={voice.held}
            onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); voice.hold(true); }}
            onPointerUp={event => { voice.hold(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => voice.hold(false)} onLostPointerCapture={() => voice.hold(false)} onBlur={() => voice.hold(false)}
            onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); voice.hold(true); } }}
            onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); voice.hold(false); } }}>
            {voice.talking ? "Speaking" : voice.held ? "Microphone live" : "Hold V or hold here to talk"}
          </button>}
          <p className="voice-notice">Nearby voice shares microphone audio with peers. It may reveal network addresses. Use headphones.</p>
          {voice.limited && <p className="muted small">Nearby voice capacity reached (six connections).</p>}
          {voice.error && <p role="alert" className="error small">{voice.error}</p>}
        </section>

        <section className="hud-section">
          <h2 className="section-label">Control Guide</h2>
          <div className="guide-row">
            <div className="guide-visual" aria-hidden="true">
              <div className="keycaps">
                <div className="keycaps-row"><span className="keycap">W</span></div>
                <div className="keycaps-row"><span className="keycap">A</span><span className="keycap">S</span><span className="keycap">D</span></div>
              </div>
            </div>
            <span className="guide-text">WASD / Shift</span>
          </div>
          <div className="guide-row">
            <div className="guide-visual" aria-hidden="true">
              <span className="keycap keycap-wide">Space</span>
            </div>
            <span className="guide-text">Jump</span>
          </div>
          <div className="guide-row">
            <div className="guide-visual" aria-hidden="true">
              <svg className="mouse-glyph" viewBox="0 0 24 34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="3" width="12" height="28" rx="6" />
                <path d="M12 3v10" />
                <path d="m9.6 6.2 2.4-2.4 2.4 2.4" />
                <path d="m9.6 27.8 2.4 2.4 2.4-2.4" />
              </svg>
            </div>
            <span className="guide-text">Orbit / Zoom</span>
          </div>
        </section>

        <p className="hud-footnote">Open a second tab to test multiplayer.</p>
        {error && <p role="alert" className="error small">{error}</p>}
      </div>
    </section>
    <div className="hud-actions" aria-hidden="true">
      <span className="icon-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </span>
      <span className="icon-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
          <path d="M9 3v15M15 6v15" />
        </svg>
      </span>
      <span className="icon-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.2 9a3 3 0 1 1 4.5 2.7c-.9.5-1.7 1.1-1.7 2.1" />
          <path d="M12 17h.01" />
        </svg>
      </span>
    </div>
  </main>;
}

export default function Page() { return <GameProvider><VoiceProvider><Game /></VoiceProvider></GameProvider>; }
