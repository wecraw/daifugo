/**
 * A hand-rolled stand-in for the Socket.IO client.
 *
 * The provider only uses `on`, `emit`, `connect`, `disconnect`, `connected` and
 * `removeAllListeners`, so a real transport buys nothing here: what these tests
 * are about is the seat protocol of §8.1 — which token is replayed, and when.
 */
import type { DaifugoClientSocket } from "../src/context/SocketContext";

type Listener = (...args: never[]) => void;

export class FakeSocket {
  connected = false;
  /** Every `emit` the client made, in order. */
  readonly sent: { event: string; args: unknown[] }[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const existing = this.listeners.get(event) ?? [];
    this.listeners.set(event, [...existing, listener]);
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.sent.push({ event, args });
    return this;
  }

  connect(): this {
    this.connected = true;
    this.fire("connect");
    return this;
  }

  disconnect(): this {
    if (!this.connected) return this;
    this.connected = false;
    this.fire("disconnect", "io client disconnect");
    return this;
  }

  /** Deliver a server-to-client event. */
  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...rest: unknown[]) => void)(...args);
    }
  }

  /** The emits for one event name, oldest first. */
  sentOf(event: string): unknown[][] {
    return this.sent.filter((entry) => entry.event === event).map((entry) => entry.args);
  }

  asSocket(): DaifugoClientSocket {
    return this as unknown as DaifugoClientSocket;
  }
}
