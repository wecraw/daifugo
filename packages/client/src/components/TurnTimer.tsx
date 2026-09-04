/**
 * The countdown ring of §10.10.
 *
 * **It renders against `state.deadline`, never against a locally started timer.**
 * The server owns the clock — `deadline` is epoch ms and the only thing `TICK`
 * fires off (§2, §7.6) — so the ring is a pure function of that deadline and the
 * wall clock. A player who reconnects halfway through a turn sees the true
 * remaining time rather than a fresh 60 seconds, and a slow round trip costs the
 * ring nothing, because nothing here counts down on its own. The interval below
 * only decides how often the same subtraction is re-rendered.
 *
 * A null deadline is nothing to render: no arm, no ring.
 */
import { useEffect, useState } from "react";
import { useTranslate } from "../i18n/index";

/** How often the ring redraws. The deadline decides what it shows; this is paint. */
export const TIMER_REDRAW_MS = 250;

/**
 * `seat` is the ring on an opponent's chip, `strip` the clock in the top strip,
 * `banner` the exchange ring centred in the middle band (§10.10).
 */
export type TurnTimerSize = "seat" | "strip" | "banner";

const RADIUS: Readonly<Record<TurnTimerSize, number>> = { seat: 10, strip: 15, banner: 28 };
const STROKE: Readonly<Record<TurnTimerSize, number>> = { seat: 3, strip: 4, banner: 6 };

export interface TurnTimerProps {
  /** `GameState.deadline`: epoch ms, server authoritative (§2). */
  deadline: number | null;
  /** The full arm this deadline was set from, so the ring starts full. */
  durationMs: number;
  size?: TurnTimerSize;
}

export function TurnTimer({ deadline, durationMs, size = "strip" }: TurnTimerProps) {
  const t = useTranslate();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    // Re-read immediately: a new deadline must not be measured against a `now`
    // left over from the previous turn.
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), TIMER_REDRAW_MS);
    return () => clearInterval(handle);
  }, [deadline]);

  if (deadline === null) return null;

  const remaining = Math.max(0, deadline - now);
  const fraction = durationMs <= 0 ? 0 : Math.min(1, remaining / durationMs);
  const seconds = Math.ceil(remaining / 1000);

  const radius = RADIUS[size];
  const stroke = STROKE[size];
  const box = (radius + stroke) * 2;
  const centre = box / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={`turn-timer turn-timer--${size}`}
      role="timer"
      aria-label={t("ui.timer.remaining", { seconds })}
    >
      <svg viewBox={`0 0 ${box} ${box}`} width={box} height={box} aria-hidden="true">
        <circle
          className="turn-timer__track"
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="turn-timer__ring"
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      </svg>
      {size !== "seat" && <span className="turn-timer__seconds">{seconds}</span>}
    </div>
  );
}
