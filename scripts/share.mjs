import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) {
    if (!child.pid || child.exitCode !== null) continue;
    if (windows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, detached: !windows, windowsHide: true, ...options });
  children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => {
    if (!stopping) { console.error(`${command} exited (${code}). Stopping sharing.`); stop(code || 1); }
  });
  const capture = stream => stream?.on("data", chunk => {
    process.stderr.write(chunk);
    child.recentOutput = ((child.recentOutput || "") + chunk.toString()).slice(-4000);
    if (/EADDRINUSE/.test(chunk.toString())) {
      console.error("A port was claimed during startup. Stop the conflicting server, then rerun npm run share.");
      stop(1);
    }
  });
  capture(child.stdout);
  capture(child.stderr);
  return child;
}

function listenerDetails(port) {
  const result = windows
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$owners = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $owners } | Select-Object ProcessId, CommandLine | Format-List | Out-String`], { encoding: "utf8", timeout: 5000, windowsHide: true })
    : spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 });
  return result.stdout?.trim() || "Listener details unavailable.";
}

async function requireFreePort(port) {
  for (const host of ["127.0.0.1", "::1"]) {
    const busy = await new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      const finish = (error, occupied) => {
        socket.destroy();
        if (error) reject(error);
        else resolve(occupied);
      };
      socket.setTimeout(1000);
      socket.once("connect", () => finish(null, true));
      socket.once("timeout", () => finish(new Error(`Cannot check ${host}:${port}: connection timed out. Sharing not started.`)));
      socket.once("error", error => {
        if (["ECONNREFUSED", "EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) finish(null, false);
        else finish(new Error(`Cannot check ${host}:${port}: ${error.message}`));
      });
    });
    if (busy) throw new Error(`Port ${port} is occupied.\n${listenerDetails(port)}\nStop the old server terminal with Ctrl+C${windows ? ", or taskkill /pid <PID> /T /F after checking its command" : ""}. Then rerun npm run share.`);
  }
}

async function waitForStack() {
  const deadline = Date.now() + 150_000;
  const wait = async (port, path, health) => {
    let lastError = "No response";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          signal: AbortSignal.timeout(Math.min(5000, deadline - Date.now())),
          redirect: "manual",
        });
        if (health) {
          if (response.status === 200 && (await response.json()).ok === true) return;
        } else {
          await response.body?.cancel();
          if (response.status >= 200 && response.status < 400) return;
        }
        lastError = `HTTP ${response.status} (not ready)`;
      } catch (error) { lastError = error.message; }
      await delay(500);
    }
    throw new Error(`Startup timed out on port ${port}: ${lastError}. Run npm run dev alone to inspect startup errors.`);
  };
  await Promise.all([wait(2567, "/health", true), wait(3000, "/", false)]);
}

function tunnel(binary, port) {
  return new Promise((resolve, reject) => {
    const child = launch(binary, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Tunnel for port ${port} did not provide a URL within 60 seconds.`)), 60_000);
    const read = chunk => {
      output = (output + chunk.toString()).slice(-16000);
      const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", () => clearTimeout(timer));
    child.once("exit", () => clearTimeout(timer));
  });
}

try {
  await Promise.all([requireFreePort(3000), requireFreePort(2567)]);
  const installed = windows && [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter(Boolean).map(base => join(base, "cloudflared", "cloudflared.exe")).find(existsSync);
  const binary = process.env.CLOUDFLARED_PATH || installed || "cloudflared";
  console.log("Opening public, unauthenticated tunnels. Ctrl+C stops both tunnels and the dev stack.");
  const [app, game] = await Promise.all([tunnel(binary, 3000), tunnel(binary, 2567)]);
  const env = {
    ...process.env,
    NEXT_PUBLIC_GAME_SERVER_URL: game.replace("https://", "wss://"),
    ALLOWED_ORIGINS: `${app},http://localhost:3000,http://127.0.0.1:3000`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (windows) launch("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { env, stdio: ["ignore", "pipe", "pipe"] });
  else launch("npm", ["run", "dev"], { env, stdio: ["ignore", "pipe", "pipe"] });
  console.log("Waiting for the local app and game server...");
  await waitForStack();
  console.log(`\nLocal app and game server ready. Share this link: ${app}\nGame endpoint: ${game}\nFirst load downloads about 141 MiB of models. Keep this terminal open.\n`);
} catch (error) {
  console.error(error.message);
  for (const child of children) {
    if (child.recentOutput) console.error(`\nRecent output (PID ${child.pid}):\n${child.recentOutput}`);
  }
  stop(1);
}
