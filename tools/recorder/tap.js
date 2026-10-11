// Poker Bot Recorder: runs in the page before the game loads, taps the
// socket.io connection (WebSocket or HTTP long-polling), decodes each packet
// and lets you download everything as a JSON capture.
(function () {
  "use strict";

  const MAX_ENTRIES = 50000;
  // authUserId/playersPlayingAuthIds are public account ids (also sent as `userId`) and are needed to follow a player across re-buys.
  const SENSITIVE_KEY = /token|^auth$|authorization|pass|secret|cookie|session|jwt|email|^sid$/i;

  // Engine.IO v4 packet types (first char of every frame).
  const EIO = { 0: "open", 1: "close", 2: "ping", 3: "pong", 4: "message", 5: "upgrade", 6: "noop" };
  // Socket.IO v5 packet types (first char inside an Engine.IO "message").
  const SIO = { 0: "CONNECT", 1: "DISCONNECT", 2: "EVENT", 3: "ACK", 4: "CONNECT_ERROR", 5: "BINARY_EVENT", 6: "BINARY_ACK" };

  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v);
      return out;
    }
    return value;
  }

  function parseJson(text) {
    if (text === "") return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // Decode one text frame, e.g. `42["bet",{"amount":30}]` or `451-["deal",{"_placeholder":true,"num":0}]`.
  function decodeFrame(frame) {
    const eio = EIO[frame[0]] ?? "unknown";
    const body = frame.slice(1);
    if (eio !== "message") return { eio, data: redact(parseJson(body)) };

    const sio = SIO[body[0]];
    if (!sio) return { eio, data: body };
    let rest = body.slice(1);
    const out = { eio, sio };

    if (sio === "BINARY_EVENT" || sio === "BINARY_ACK") {
      const m = /^(\d+)-/.exec(rest);
      if (m) {
        out.attachments = Number(m[1]);
        rest = rest.slice(m[0].length);
      }
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

    const payload = redact(parseJson(rest));
    if ((sio === "EVENT" || sio === "BINARY_EVENT") && Array.isArray(payload)) {
      out.event = payload[0];
      out.args = payload.slice(1);
    } else {
      out.data = payload;
    }
    return out;
  }

  // HTTP long-polling bodies hold several frames joined by the record separator.
  function decodePollingBody(body) {
    return body.split("\x1e").filter(Boolean).map(decodeFrame);
  }

  function safeUrl(url) {
    try {
      const u = new URL(url, typeof location === "undefined" ? undefined : location.href);
      const keep = new URLSearchParams();
      for (const k of ["EIO", "transport"]) if (u.searchParams.has(k)) keep.set(k, u.searchParams.get(k));
      return `${u.origin}${u.pathname}?${keep}`;
    } catch {
      return String(url);
    }
  }

  function bytesToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  if (typeof window === "undefined") {
    module.exports = { decodeFrame, decodePollingBody, redact, safeUrl };
    return;
  }

  // ---- Live recording (browser only) ----

  const started = Date.now();
  const log = { recorder: "0.1.1", page: location.origin + location.pathname, startedAt: new Date(started).toISOString(), entries: [] };
  let button = null;

  function push(entry) {
    if (log.entries.length >= MAX_ENTRIES) return;
    log.entries.push({ t: Date.now() - started, ...entry });
    updateButton();
  }

  function recordText(dir, transport, text) {
    for (const packet of transport === "poll" ? decodePollingBody(text) : [decodeFrame(text)]) {
      if (packet.eio === "ping" || packet.eio === "pong") continue;
      push({ dir, transport, ...packet });
    }
  }

  function recordData(dir, transport, data) {
    if (typeof data === "string") return recordText(dir, transport, data);
    if (data instanceof ArrayBuffer) return push({ dir, transport, binary: bytesToBase64(data) });
    if (ArrayBuffer.isView(data)) return push({ dir, transport, binary: bytesToBase64(data.buffer) });
    if (data instanceof Blob) data.arrayBuffer().then((b) => push({ dir, transport, binary: bytesToBase64(b) }));
  }

  // WebSocket tap. engine.io-client reads globalThis.WebSocket when its bundle
  // loads, so this must be installed at document_start.
  const NativeWebSocket = window.WebSocket;
  class TappedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const isGame = String(url).includes("socket.io");
      if (!isGame) return;
      push({ dir: "meta", transport: "ws", event: "socket-open", url: safeUrl(url) });
      this.addEventListener("message", (e) => recordData("in", "ws", e.data));
      this.addEventListener("close", (e) => push({ dir: "meta", transport: "ws", event: "socket-close", code: e.code }));
      this._pbTapped = true;
    }
    send(data) {
      if (this._pbTapped) recordData("out", "ws", data);
      return super.send(data);
    }
  }
  window.WebSocket = TappedWebSocket;

  // Long-polling tap (used before the upgrade to WebSocket, or as a fallback).
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._pbGame = String(url).includes("socket.io");
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this._pbGame) {
      if (typeof body === "string" && body) recordText("out", "poll", body);
      this.addEventListener("load", () => {
        if (typeof this.response === "string" && this.response) recordText("in", "poll", this.response);
      });
    }
    return nativeSend.call(this, body);
  };

  function download() {
    const blob = new Blob([JSON.stringify(log, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pokerpatio-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function updateButton() {
    if (!button) {
      if (!document.body) return;
      button = document.createElement("button");
      button.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:6px 10px;border:0;border-radius:6px;" +
        "background:#b91c1c;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;opacity:.85";
      button.title = "Poker Bot Recorder: click to save the capture";
      button.addEventListener("click", download);
      document.body.appendChild(button);
    }
    button.textContent = `● REC ${log.entries.length} msgs · save`;
  }

  document.addEventListener("DOMContentLoaded", () => log.entries.length && updateButton());
})();
