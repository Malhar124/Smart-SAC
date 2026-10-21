import { logger } from "./logger.js";

// Server-Sent Events hub. Browsers keep one GET /api/v1/events connection open; when something
// changes, the server pushes a small {type, ...ids} message and the page refetches what it shows.
// State is per process: with more than one backend instance, swap publish() for a shared bus (e.g. Redis).

const clients = new Map();
let nextClientId = 0;
const HEARTBEAT_MS = 25 * 1000;

/** Attach the response as a live stream for req.account. Ends when the browser disconnects. */
export const subscribe = (req, res) => {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stop nginx from buffering the stream
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 5000\n\n");
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const id = ++nextClientId;
  clients.set(id, { res, kind: req.account.kind, accountId: req.account.id });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(id);
  });
};

const matches = (client, audience) =>
  audience.everyone ||
  (audience.admins && client.kind === "admin") ||
  (audience.allUsers && client.kind === "user") ||
  (audience.users && client.kind === "user" && audience.users.includes(client.accountId));

/**
 * Push an event. Audience: { everyone } | { admins } | { allUsers } | { users: [ids] }, combinable.
 * Payloads carry ids only; clients refetch through the normal (authorised) endpoints.
 */
export const publish = (type, data = {}, audience = { everyone: true }) => {
  const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  let sent = 0;
  for (const client of clients.values()) {
    if (!matches(client, audience)) continue;
    client.res.write(message);
    sent += 1;
  }
  logger.debug({ type, sent }, "live event published");
};

export const connectedClientCount = () => clients.size;

/** Close every stream (used on shutdown so the server can exit) */
export const closeAllStreams = () => {
  for (const client of clients.values()) client.res.end();
  clients.clear();
};
