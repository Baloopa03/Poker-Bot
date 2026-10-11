// Engine.IO v4 / Socket.IO v5 frame decoding (same logic as tools/recorder/tap.js).

export interface Packet {
  /** "in" = server → us, "out" = us → server. */
  dir: "in" | "out" | "meta";
  eio?: string;
  sio?: string;
  ns?: string;
  ack?: number;
  event?: string;
  args?: unknown[];
  data?: unknown;
  /** Milliseconds since capture start (recordings only). */
  t?: number;
}

const EIO: Record<string, string> = { 0: "open", 1: "close", 2: "ping", 3: "pong", 4: "message", 5: "upgrade", 6: "noop" };
const SIO: Record<string, string> = {
  0: "CONNECT",
  1: "DISCONNECT",
  2: "EVENT",
  3: "ACK",
  4: "CONNECT_ERROR",
  5: "BINARY_EVENT",
  6: "BINARY_ACK",
};

function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function decodeFrame(frame: string, dir: Packet["dir"]): Packet {
  const eio = EIO[frame[0]] ?? "unknown";
  const body = frame.slice(1);
  if (eio !== "message") return { dir, eio, data: parseJson(body) };
  const sio = SIO[body[0]];
  if (!sio) return { dir, eio, data: body };
  let rest = body.slice(1);
  const out: Packet = { dir, eio, sio };
  if (sio === "BINARY_EVENT" || sio === "BINARY_ACK") {
    const m = /^(\d+)-/.exec(rest);
    if (m) rest = rest.slice(m[0].length);
  }
  if (rest[0] === "/") {
    const comma = rest.indexOf(",");
    out.ns = comma === -1 ? rest : rest.slice(0, comma);
    rest = comma === -1 ? "" : rest.slice(comma + 1);
  }
  const ack = /^\d+/.exec(rest);
  if (ack) {
    out.ack = Number(ack[0]);
    rest = rest.slice(ack[0].length);
  }
  const payload = parseJson(rest);
  if ((sio === "EVENT" || sio === "BINARY_EVENT") && Array.isArray(payload)) {
    out.event = String(payload[0]);
    out.args = payload.slice(1);
  } else out.data = payload;
  return out;
}
