"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Vector3, type Camera } from "three";
import { isRecord, isVoicePeers, isVoiceSignal, VOICE_EXIT_RANGE, type IncomingVoiceSignal, type VoicePeer } from "@game/shared/social";
import { useGame } from "./GameProvider";

type Voice = {
  status: "off" | "requesting" | "enabled";
  talking: boolean;
  held: boolean;
  limited: boolean;
  error: string | null;
  enable: () => void;
  disable: () => void;
  hold: (down: boolean) => void;
  updateSpatial: (camera: Camera) => void;
};
type Peer = {
  id: string; token: string; pc: RTCPeerConnection; queue: RTCIceCandidateInit[];
  chain: Promise<void>; makingOffer: boolean; ignoreOffer: boolean; timeout?: ReturnType<typeof setTimeout>;
  source?: MediaStreamAudioSourceNode; panner?: PannerNode; gain?: GainNode;
};
const VoiceContext = createContext<Voice | null>(null);
const editable = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { activeRoom, snapshots, sessionId } = useGame();
  const [status, setStatus] = useState<Voice["status"]>("off");
  const [talking, setTalking] = useState(false);
  const [held, setHeld] = useState(false);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef({ enable: () => {}, disable: () => {}, hold: (_down: boolean) => {}, updateSpatial: (_camera: Camera) => {} });

  useEffect(() => {
    setStatus("off"); setTalking(false); setHeld(false); setLimited(false);
    if (!activeRoom || !sessionId) return;
    const room = activeRoom, ownId = sessionId;
    let disposed = false, generation = 0;
    let stream: MediaStream | null = null, context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null, localSource: MediaStreamAudioSourceNode | null = null;
    let samples: Float32Array<ArrayBuffer> | null = null;
    let enabled = false, requesting = false, keyHeld = false, pointerHeld = false, isSpeaking = false;
    let lastSound = 0, lastReport = 0;
    const peers = new Map<string, Peer>();
    let admitted = new Map<string, VoicePeer>();
    const forward = new Vector3(), up = new Vector3();
    const send = (kind: string, value: unknown) => {
      if (!disposed && room.connection.isOpen) room.send(kind, value);
    };
    const closePeer = (peer: Peer) => {
      peers.delete(peer.id);
      clearTimeout(peer.timeout);
      peer.pc.onicecandidate = null; peer.pc.ontrack = null;
      peer.pc.onnegotiationneeded = null; peer.pc.onconnectionstatechange = null;
      peer.pc.close(); peer.source?.disconnect(); peer.panner?.disconnect(); peer.gain?.disconnect();
      peer.queue.length = 0;
    };
    const live = (peer: Peer) => !disposed && enabled && peers.get(peer.id) === peer && admitted.get(peer.id)?.token === peer.token;
    const activity = (value: boolean, force = false) => {
      if (value !== isSpeaking || force) {
        isSpeaking = value;
        if (!disposed) setTalking(value);
        send("voice-speaking", value);
        lastReport = performance.now();
      }
    };
    const applyHold = () => {
      const down = enabled && (keyHeld || pointerHeld) && !document.hidden && context?.state === "running";
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = down;
      if (!disposed) setHeld(down);
      if (!down) { lastSound = 0; activity(false); }
    };
    const release = () => { keyHeld = false; pointerHeld = false; applyHold(); };
    const disable = () => {
      generation++; requesting = false; enabled = false;
      release(); activity(false); send("voice-enabled", false);
      for (const peer of [...peers.values()]) closePeer(peer);
      admitted.clear();
      for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
      stream = null; localSource?.disconnect(); localSource = null; analyser?.disconnect(); analyser = null; samples = null;
      const old = context; context = null;
      if (old) { old.onstatechange = null; void old.close().catch(() => {}); }
      if (!disposed) { setStatus("off"); setLimited(false); }
    };
    const failure = (cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : "Voice connection failed. Disable and re-enable voice to retry.");
    };
    const signal = (peer: Peer, value: Record<string, unknown>) => {
      const message = { to: peer.id, token: peer.token, ...value };
      if (live(peer) && isVoiceSignal(message)) send("voice-signal", message);
      else if (live(peer)) failure(new Error("Voice signaling exceeded the supported size. Disable voice and retry."));
    };
    const createPeer = (description: VoicePeer) => {
      if (!enabled || !stream || peers.has(description.id)) return;
      // ponytail: STUN-only small-group demo; use authenticated short-lived TURN credentials for reliable NAT traversal.
      const stun = process.env.NEXT_PUBLIC_VOICE_STUN_URL || "stun:stun.l.google.com:19302";
      const pc = new RTCPeerConnection({ iceServers: [{ urls: stun }], bundlePolicy: "max-bundle" });
      const peer: Peer = { ...description, pc, queue: [], chain: Promise.resolve(), makingOffer: false, ignoreOffer: false };
      peers.set(peer.id, peer);
      const connectionTimeout = () => {
        clearTimeout(peer.timeout);
        peer.timeout = setTimeout(() => {
          if (live(peer) && pc.connectionState !== "connected") {
            failure(new Error("Nearby voice timed out. Disable and re-enable voice; restrictive networks may require TURN."));
            closePeer(peer);
          }
        }, 20000);
      };
      connectionTimeout();
      pc.onicecandidate = event => {
        if (!live(peer) || !event.candidate) return;
        const c = event.candidate;
        signal(peer, { kind: "ice", candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment } });
      };
      pc.ontrack = event => {
        if (!live(peer) || !context || event.track.kind !== "audio" || peer.source) return;
        const remote = new MediaStream([event.track]);
        peer.source = context.createMediaStreamSource(remote);
        peer.panner = context.createPanner(); peer.panner.panningModel = "equalpower";
        peer.panner.rolloffFactor = 0;
        peer.gain = context.createGain(); peer.gain.gain.value = 0;
        peer.source.connect(peer.panner).connect(peer.gain).connect(context.destination);
      };
      pc.onconnectionstatechange = () => {
        if (!live(peer)) return;
        if (pc.connectionState === "connected") clearTimeout(peer.timeout);
        else if (pc.connectionState === "disconnected") connectionTimeout();
        if (pc.connectionState === "failed") {
          // ponytail: manual re-enable retries avoid peer reconnect storms; add coordinated ICE restart with TURN.
          failure(new Error("Nearby voice connection failed (NAT/firewall). Disable and re-enable voice to retry; TURN may be required."));
          closePeer(peer);
        }
      };
      pc.onnegotiationneeded = () => {
        if (!live(peer) || ownId > peer.id) return;
        peer.chain = peer.chain.then(async () => {
          if (!live(peer) || pc.signalingState !== "stable") return;
          try {
            peer.makingOffer = true;
            await pc.setLocalDescription(await pc.createOffer());
            if (live(peer) && pc.localDescription) signal(peer, { kind: "offer", sdp: pc.localDescription.sdp });
          } finally { peer.makingOffer = false; }
        }).catch(cause => { if (live(peer)) failure(cause); });
      };
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    };
    const unlistenError = room.onMessage("voice-error", (value: unknown) => {
      if (typeof value === "string" && value.length <= 256) { disable(); failure(new Error(value)); }
    });
    const unlistenPeers = room.onMessage("voice-peers", (value: unknown) => {
      if (!isVoicePeers(value) || !enabled) return;
      const next = new Map(value.peers.filter(p => p.id !== ownId).map(p => [p.id, p]));
      admitted = next;
      setLimited(value.limited);
      for (const peer of [...peers.values()]) if (next.get(peer.id)?.token !== peer.token) closePeer(peer);
      for (const peer of next.values()) {
        try { createPeer(peer); } catch (cause) { failure(cause); }
      }
    });
    const unlistenSignal = room.onMessage("voice-signal", (value: unknown) => {
      if (!isRecord(value) || typeof value.from !== "string" || !isVoiceSignal(value) || value.to !== ownId) return;
      const message = value as IncomingVoiceSignal, peer = peers.get(message.from);
      if (!peer || !live(peer) || peer.token !== message.token) return;
      peer.chain = peer.chain.then(async () => {
        if (!live(peer)) return;
        const pc = peer.pc;
        if (message.kind === "ice") {
          if (peer.ignoreOffer || message.candidate === null) return;
          if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
          else if (peer.queue.length < 64) peer.queue.push(message.candidate);
          else throw new Error("Too many queued voice candidates");
          return;
        }
        const collision = message.kind === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = ownId < peer.id && collision;
        if (peer.ignoreOffer) return;
        if (message.kind === "answer" && pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription({ type: message.kind, sdp: message.sdp });
        if (!live(peer)) return;
        for (const candidate of peer.queue.splice(0)) {
          await pc.addIceCandidate(candidate);
          if (!live(peer)) return;
        }
        if (message.kind === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          if (live(peer) && pc.localDescription) signal(peer, { kind: "answer", sdp: pc.localDescription.sdp });
        }
      }).catch(cause => { if (live(peer)) failure(cause); });
    });
    const enable = async () => {
      if (disposed || enabled || requesting) return;
      setError(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        failure(new Error("Voice needs a supported browser on HTTPS or localhost.")); return;
      }
      const attempt = ++generation;
      requesting = true; setStatus("requesting");
      let acquired: MediaStream | null = null;
      try {
        context = new AudioContext();
        await context.resume();
        if (disposed || attempt !== generation) return;
        acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
        for (const track of acquired.getAudioTracks()) track.enabled = false;
        if (disposed || attempt !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
        stream = acquired;
        if (disposed || attempt !== generation || !context) return;
        if (context.state !== "running") throw new Error("Audio playback blocked. Disable voice and click Enable voice again.");
        analyser = context.createAnalyser(); analyser.fftSize = 512;
        samples = new Float32Array(analyser.fftSize);
        localSource = context.createMediaStreamSource(stream); localSource.connect(analyser);
        for (const track of stream.getTracks()) track.onended = () => {
          failure(new Error("Microphone disconnected. Enable voice again after reconnecting it.")); disable();
        };
        context.onstatechange = () => {
          if (context && context.state !== "running" && enabled) {
            release(); failure(new Error("Audio suspended. Disable voice and click Enable voice again."));
          }
        };
        enabled = true; requesting = false; setStatus("enabled"); send("voice-enabled", true);
      } catch (cause) {
        if (attempt === generation && !disposed) { acquired?.getTracks().forEach(t => t.stop()); disable(); failure(cause); }
      }
    };
    const down = (event: KeyboardEvent) => {
      if (event.code !== "KeyV" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
      if (enabled) { event.preventDefault(); keyHeld = true; applyHold(); }
    };
    const upKey = (event: KeyboardEvent) => { if (event.code === "KeyV") { keyHeld = false; applyHold(); } };
    const focus = (event: FocusEvent) => { if (editable(event.target)) release(); };
    const timer = window.setInterval(() => {
      if (!enabled || !analyser || !samples) return;
      const now = performance.now();
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const transmitting = (keyHeld || pointerHeld) && !!stream?.getAudioTracks()[0]?.enabled;
      if (transmitting && Math.sqrt(energy / samples.length) > 0.015) lastSound = now;
      const speaking = transmitting && lastSound > 0 && now - lastSound < 300;
      activity(speaking, speaking && now - lastReport > 250);
    }, 50);
    window.addEventListener("keydown", down); window.addEventListener("keyup", upKey);
    window.addEventListener("blur", release); document.addEventListener("visibilitychange", release);
    document.addEventListener("focusin", focus);
    controller.current = {
      enable: () => { void enable(); }, disable,
      hold: value => { pointerHeld = value; applyHold(); },
      updateSpatial: camera => {
        if (!enabled || !context) return;
        const own = snapshots.current.get(ownId), now = context.currentTime;
        if (!own) { for (const peer of peers.values()) peer.gain?.gain.setTargetAtTime(0, now, 0.03); return; }
        camera.getWorldDirection(forward); up.copy(camera.up).applyQuaternion(camera.quaternion);
        const listener = context.listener;
        listener.positionX.value = own.x; listener.positionY.value = own.y + 1; listener.positionZ.value = own.z;
        listener.forwardX.value = forward.x; listener.forwardY.value = forward.y; listener.forwardZ.value = forward.z;
        listener.upX.value = up.x; listener.upY.value = up.y; listener.upZ.value = up.z;
        for (const peer of peers.values()) {
          if (!peer.panner || !peer.gain) continue;
          const target = snapshots.current.get(peer.id);
          const distance = target ? Math.hypot(target.x - own.x, target.z - own.z) : Infinity;
          const gain = distance >= VOICE_EXIT_RANGE ? 0 : Math.min(1, Math.max(0, (VOICE_EXIT_RANGE - distance) / (VOICE_EXIT_RANGE - 2)));
          peer.gain.gain.setTargetAtTime(gain, now, 0.04);
          if (target) {
            peer.panner.positionX.value = target.x; peer.panner.positionY.value = target.y + 1; peer.panner.positionZ.value = target.z;
          }
        }
      },
    };
    return () => {
      disable(); disposed = true;
      clearInterval(timer); unlistenPeers(); unlistenSignal(); unlistenError();
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", upKey);
      window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", release);
      document.removeEventListener("focusin", focus);
      controller.current = { enable: () => {}, disable: () => {}, hold: () => {}, updateSpatial: () => {} };
    };
  }, [activeRoom, sessionId, snapshots]);

  return <VoiceContext.Provider value={{ status, talking, held, limited, error,
    enable: () => controller.current.enable(), disable: () => controller.current.disable(),
    hold: value => controller.current.hold(value), updateSpatial: camera => controller.current.updateSpatial(camera),
  }}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const voice = useContext(VoiceContext);
  if (!voice) throw new Error("useVoice must be used inside VoiceProvider");
  return voice;
}
