import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";

const port = Number(process.env.PORT ?? 2567);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const origins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map(s => s.trim());
const allowed = (origin: string | undefined) => origin === undefined || origins.includes(origin);
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else { res.writeHead(404); res.end(); }
});
const server = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    maxPayload: 32768,
    verifyClient: ({ origin }: { origin: string }) => allowed(origin),
  }),
});
// Wrap the installed matchmaking listener so rejected requests never reach it.
// Origin checks are browser policy, not authentication; native clients may omit Origin.
const handlers = httpServer.listeners("request");
httpServer.removeAllListeners("request");
httpServer.on("request", (req, res) => {
  if (!allowed(req.headers.origin)) { res.writeHead(403); res.end("Origin not allowed"); return; }
  for (const handler of handlers) handler.call(httpServer, req, res);
});
server.define("game", GameRoom);
await server.listen(port);
console.log(`Game server listening on http://localhost:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void server.gracefullyShutdown(false).then(() => process.exit(0)); });
}
