"use strict";
(() => {
  // src/adapter/pokerpatio/socketio.ts
  var EIO = { 0: "open", 1: "close", 2: "ping", 3: "pong", 4: "message", 5: "upgrade", 6: "noop" };
  var SIO = {
    0: "CONNECT",
    1: "DISCONNECT",
    2: "EVENT",
    3: "ACK",
    4: "CONNECT_ERROR",
    5: "BINARY_EVENT",
    6: "BINARY_ACK"
  };
  function parseJson(text) {
    if (text === "") return void 0;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  function decodeFrame(frame, dir) {
    const eio = EIO[frame[0]] ?? "unknown";
    const body = frame.slice(1);
    if (eio !== "message") return { dir, eio, data: parseJson(body) };
    const sio = SIO[body[0]];
    if (!sio) return { dir, eio, data: body };
    let rest = body.slice(1);
    const out = { dir, eio, sio };
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

  // src/extension/page.ts
  var SOURCE = "pokerbot-page";
  function forward(dir, data) {
    if (typeof data !== "string") return;
    for (const frame of data.split("")) {
      if (!frame || frame === "2" || frame === "3") continue;
      try {
        const packet = decodeFrame(frame, dir);
        window.postMessage({ source: SOURCE, packet }, location.origin);
      } catch {
      }
    }
  }
  var NativeWebSocket = window.WebSocket;
  var TappedWebSocket = class extends NativeWebSocket {
    pbGame;
    constructor(url, protocols) {
      super(url, protocols);
      this.pbGame = String(url).includes("socket.io");
      if (!this.pbGame) return;
      window.postMessage({ source: SOURCE, packet: { dir: "meta", event: "socket-open" } }, location.origin);
      this.addEventListener("message", (e) => forward("in", e.data));
    }
    send(data) {
      if (this.pbGame) forward("out", data);
      super.send(data);
    }
  };
  window.WebSocket = TappedWebSocket;
  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(...args) {
    this.pbGame = String(args[1]).includes("socket.io");
    return nativeOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.pbGame) {
      if (typeof body === "string") forward("out", body);
      this.addEventListener("load", () => {
        if (typeof this.response === "string") forward("in", this.response);
      });
    }
    return nativeSend.call(this, body);
  };
})();
