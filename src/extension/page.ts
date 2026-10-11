// Runs in the page's own JS world at document_start. Copies every socket.io
// frame of the game connection and forwards the decoded packets to the
// extension's content script. It never sends anything to the game server.
import { type Packet, decodeFrame } from "../adapter/pokerpatio/socketio";

const SOURCE = "pokerbot-page";

function forward(dir: Packet["dir"], data: unknown): void {
  if (typeof data !== "string") return; // game traffic is text JSON
  for (const frame of data.split("\x1e")) {
    if (!frame || frame === "2" || frame === "3") continue; // ping / pong
    try {
      const packet = decodeFrame(frame, dir);
      window.postMessage({ source: SOURCE, packet }, location.origin);
    } catch {
      /* ignore malformed frames */
    }
  }
}

const NativeWebSocket = window.WebSocket;
class TappedWebSocket extends NativeWebSocket {
  private readonly pbGame: boolean;
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.pbGame = String(url).includes("socket.io");
    if (!this.pbGame) return;
    window.postMessage({ source: SOURCE, packet: { dir: "meta", event: "socket-open" } }, location.origin);
    this.addEventListener("message", (e) => forward("in", e.data));
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.pbGame) forward("out", data);
    super.send(data);
  }
}
window.WebSocket = TappedWebSocket as typeof WebSocket;

// Long-polling fallback (before the socket upgrades, or if WebSocket is blocked).
const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { pbGame?: boolean }, ...args: unknown[]) {
  this.pbGame = String(args[1]).includes("socket.io");
  return (nativeOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { pbGame?: boolean }, body?: Document | XMLHttpRequestBodyInit | null) {
  if (this.pbGame) {
    if (typeof body === "string") forward("out", body);
    this.addEventListener("load", () => {
      if (typeof this.response === "string") forward("in", this.response);
    });
  }
  return nativeSend.call(this, body as XMLHttpRequestBodyInit | null | undefined);
};
