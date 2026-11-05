import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const windows = process.platform === "win32";
export const MAX_RESTARTS = 5;
export const STARTUP_TIMEOUT_MS = 150_000;
export const RESTART_TIMEOUT_MS = 90_000;
export const RESTART_DELAY_MS = 2000;

const children = [];
let stopping = false;

export function isStopping() {
  return stopping;
}

export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (windows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
  }
}

export function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) killTree(child);
  process.exit(code);
}

export function installSignalHandlers() {
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
}

// Resolves with the exit code once the child exits, including when it already has.
export function exitOf(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(child.exitCode);
    else child.once("exit", resolve);
  });
}

// `supervised` children are owned by the caller: their exit is reported through the
// returned promise instead of tearing the whole session down.
export function launch(command, args, options = {}) {
  const { supervised = false, allowAddrInUse = false, ...spawnOptions } = options;
  const child = spawn(command, args, { cwd: root, detached: !windows, windowsHide: true, ...spawnOptions });
  children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => {
    const index = children.indexOf(child);
    if (index !== -1) children.splice(index, 1);
    if (stopping || supervised) return;
    console.error(`${command} exited (${code}). Stopping sharing.`);
    stop(code || 1);
  });
  const capture = stream => stream?.on("data", chunk => {
    process.stderr.write(chunk);
    child.recentOutput = ((child.recentOutput || "") + chunk.toString()).slice(-4000);
    if (!supervised && !allowAddrInUse && /EADDRINUSE/.test(chunk.toString())) {
      console.error("A port was claimed during startup. Stop the conflicting server, then rerun npm run share.");
      stop(1);
    }
  });
  capture(child.stdout);
  capture(child.stderr);
  return child;
}

// npm needs a shell wrapper on Windows; spawn it directly elsewhere.
export function npm(args, options = {}) {
  return windows
    ? launch("cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`], options)
    : launch("npm", args, options);
}

// A crashed npm/concurrently tree can leave grandchildren holding 3000 or 2567 after
// its wrapper exits, which would make every respawn fail. Only processes whose command
// line points into this project are stopped, so unrelated listeners are left alone.
export function clearOrphanListeners() {
  const ports = [3000, 2567];
  if (windows) {
    const script = ports.map(port => `$owners += @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)`).join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$owners = @(); ${script}; $owners = $owners | Sort-Object -Unique | Where-Object { $_ -and $_ -ne $PID };` +
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $owners -and $_.CommandLine -like '*${root.replace(/'/g, "''")}*' } |` +
      ` ForEach-Object { "Stopping orphaned listener $($_.ProcessId): $($_.CommandLine)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { encoding: "utf8", timeout: 10_000, windowsHide: true });
    return result.stdout?.trim() ?? "";
  }
  const pids = new Set();
  for (const port of ports) {
    const result = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 });
    for (const pid of (result.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean)) pids.add(pid);
  }
  for (const pid of pids) {
    if (spawnSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).stdout?.includes(root)) {
      console.log(`Stopping orphaned listener ${pid}`);
      spawnSync("kill", ["-TERM", pid], { stdio: "ignore" });
    }
  }
  return "";
}

function listenerDetails(port) {
  const result = windows
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$owners = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $owners } | Select-Object ProcessId, CommandLine | Format-List | Out-String`], { encoding: "utf8", timeout: 5000, windowsHide: true })
    : spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 });
  return result.stdout?.trim() || "Listener details unavailable.";
}

export async function requireFreePort(port) {
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
        else reject(new Error(`Cannot check ${host}:${port}: ${error.message}`));
      });
    });
    if (busy) throw new Error(`Port ${port} is occupied.\n${listenerDetails(port)}\nStop the old server terminal with Ctrl+C${windows ? ", or taskkill /pid <PID> /T /F after checking its command" : ""}. Then rerun npm run share.`);
  }
}

export async function waitForStack(deadline = Date.now() + STARTUP_TIMEOUT_MS) {
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

export function resolveCloudflared() {
  const installed = windows && [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter(Boolean).map(base => join(base, "cloudflared", "cloudflared.exe")).find(existsSync);
  return process.env.CLOUDFLARED_PATH || installed || "cloudflared";
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

// Opens both public tunnels and returns their URLs. The tunnels stay fatal: if one
// dies the printed link is gone, so the session ends.
export async function openTunnels() {
  const binary = resolveCloudflared();
  console.log("Opening public, unauthenticated tunnels. Ctrl+C stops both tunnels and the dev stack.");
  const [app, game] = await Promise.all([tunnel(binary, 3000), tunnel(binary, 2567)]);
  return { app, game };
}

export function stackEnv({ app, game }) {
  return {
    ...process.env,
    NEXT_PUBLIC_GAME_SERVER_URL: game.replace("https://", "wss://"),
    ALLOWED_ORIGINS: `${app},http://localhost:3000,http://127.0.0.1:3000`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
