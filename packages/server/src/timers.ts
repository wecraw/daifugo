/**
 * The per-instance timer layer (§8.3, §14).
 *
 * Two things run on a clock here:
 *
 * - **Deadlines.** A `state.deadline` (a turn or the exchange) is armed as a
 *   `setTimeout` that injects a `TICK`. This is the low-latency fast path of the
 *   two-layer timer scheme (§14); the ~5s Firestore sweeper (#22) is the
 *   correctness backstop for when the instance that armed this dies. Both inject
 *   the same `TICK`, and the `stateVersion` CAS plus the no-op-on-early-`TICK`
 *   rule mean at most one transition lands per deadline.
 * - **Disconnect grace.** A 30s timer per disconnected player, governing seat
 *   removal only (§8.3). Turn timers keep running for a disconnected player, so
 *   they auto-pass on schedule and the table never stalls; the grace timer is the
 *   separate clock that eventually removes the seat if they do not return.
 *
 * The `Scheduler` is an interface so tests drive it deterministically with
 * {@link ManualScheduler} rather than waiting on real wall-clock time.
 */

/** Disconnect grace period: seat removal only (§8.3). */
export const DISCONNECT_GRACE_MS = 30_000;

export interface Scheduler {
  /** Current epoch ms. The only clock the server reads. */
  now(): number;
  /**
   * Arm a one-shot timer under `key`, replacing any existing timer with that key.
   * The callback fires once, `delayMs` from now (or as soon as a manual clock
   * passes that point).
   */
  set(key: string, delayMs: number, fn: () => void | Promise<void>): void;
  /** Cancel the timer under `key`, if any. */
  clear(key: string): void;
}

/** Timer key for a room's armed deadline (turn or exchange). */
export function deadlineKey(roomId: string): string {
  return `deadline:${roomId}`;
}

/** Timer key for one player's disconnect grace in a room (§8.3). */
export function graceKey(roomId: string, playerId: string): string {
  return `grace:${roomId}:${playerId}`;
}

/**
 * The production scheduler: `Date.now()` and `setTimeout`.
 *
 * Timers are `unref`-ed so a room armed and then abandoned never keeps the
 * process alive on its own — the HTTP listener does that — and a rejected async
 * callback is swallowed with `onError` rather than becoming an unhandled
 * rejection.
 */
export class RealScheduler implements Scheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onError: (error: unknown) => void = () => {}) {}

  now(): number {
    return Date.now();
  }

  set(key: string, delayMs: number, fn: () => void | Promise<void>): void {
    this.clear(key);
    const handle = setTimeout(
      () => {
        this.timers.delete(key);
        void Promise.resolve()
          .then(fn)
          .catch((error: unknown) => this.onError(error));
      },
      Math.max(0, delayMs),
    );
    handle.unref?.();
    this.timers.set(key, handle);
  }

  clear(key: string): void {
    const handle = this.timers.get(key);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(key);
    }
  }
}

/**
 * A scheduler with a clock the test moves by hand (§12.4). `advance` walks the
 * clock forward, firing every timer whose deadline it crosses in due order, and
 * awaits each callback so a test can assert the state that resulted.
 *
 * Callbacks armed during an `advance` are themselves fired if they fall within
 * the same window, so a grace expiry that arms a follow-up timer resolves in one
 * call.
 */
export class ManualScheduler implements Scheduler {
  private current: number;
  private readonly timers = new Map<string, { at: number; fn: () => void | Promise<void> }>();

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  set(key: string, delayMs: number, fn: () => void | Promise<void>): void {
    this.timers.set(key, { at: this.current + Math.max(0, delayMs), fn });
  }

  clear(key: string): void {
    this.timers.delete(key);
  }

  /** Move the clock to `now + ms`, firing every timer due within the window. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      let nextKey: string | null = null;
      let nextAt = Infinity;
      for (const [key, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextKey = key;
        }
      }
      if (nextKey === null) break;
      const timer = this.timers.get(nextKey)!;
      this.timers.delete(nextKey);
      this.current = timer.at;
      await timer.fn();
    }
    this.current = target;
  }

  /** Test helper: is a timer armed under `key`? */
  has(key: string): boolean {
    return this.timers.has(key);
  }
}
