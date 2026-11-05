import { setTimeout as delay } from "node:timers/promises";
import {
  MAX_RESTARTS, STARTUP_TIMEOUT_MS, RESTART_TIMEOUT_MS, RESTART_DELAY_MS,
  clearOrphanListeners, exitOf, installSignalHandlers, isStopping, killTree, npm, openTunnels,
  requireFreePort, stackEnv, stop, waitForStack,
} from "./share-lib.mjs";

installSignalHandlers();

// Keeps the tunnels (and their URLs) alive for the whole session. The dev stack is
// restarted in place when it exits, so the link handed out keeps working. Only
// Ctrl+C, a dead tunnel, or repeated failed restarts end the session.
async function supervise(env, links) {
  const { app, game } = links;
  let restarts = 0;
  for (;;) {
    const startedAt = Date.now();
    const child = npm(["run", "dev"], { env, stdio: ["ignore", "pipe", "pipe"], supervised: true });
    const exited = exitOf(child);
    try {
      await waitForStack(startedAt + (restarts === 0 ? STARTUP_TIMEOUT_MS : RESTART_TIMEOUT_MS));
    } catch (error) {
      console.error(error.message);
      killTree(child);
      await Promise.race([exited, delay(5000)]);
      if (isStopping()) return;
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        console.error(`The dev stack failed to start ${restarts} times. Giving up; fix the error, then rerun npm run share.`);
        stop(1);
      }
      console.error(`Retrying in ${RESTART_DELAY_MS / 1000}s (retry ${restarts}/${MAX_RESTARTS}). Tunnel URLs are unchanged.`);
      clearOrphanListeners();
      await delay(RESTART_DELAY_MS);
      continue;
    }
    if (restarts === 0) {
      console.log(`\nLocal app and game server ready. Share this link: ${app}\nGame endpoint: ${game}\nFirst load downloads about 141 MiB of models. Keep this terminal open.\n`);
    } else {
      console.log(`\nDev stack is back up. The same link still works: ${app}\nGame endpoint: ${game}\n`);
    }
    // A stack that stayed up this long is healthy; unrelated crashes later should not
    // count against the restart budget.
    restarts = 0;
    const code = await exited;
    if (isStopping()) return;
    console.error(`Dev stacks exited (code ${code}). Restarting in ${RESTART_DELAY_MS / 1000}s. Tunnel URLs are unchanged.`);
    // The stack wrapper can exit before its children release the ports, so clear
    // leftovers pointed at this project before respawning.
    clearOrphanListeners();
    await delay(RESTART_DELAY_MS);
  }
}

try {
  await Promise.all([requireFreePort(3000), requireFreePort(2567)]);
  const links = await openTunnels();
  const env = stackEnv(links);
  console.log("Waiting for the local app and game server...");
  await supervise(env, links);
} catch (error) {
  console.error(error.message);
  stop(1);
}
