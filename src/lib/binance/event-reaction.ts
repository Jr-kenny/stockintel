/**
 * Priced-in, judged against the tape on the day.
 *
 * The old call gated on `confidence >= 70`, so "priced in" really meant "our
 * evidence is thin and the stock ran recently". That is a statement about our
 * sourcing, not about the market.
 *
 * The honest question is narrower: when this event broke, did the price move?
 * Both inputs already existed and were never joined — every claim carries an
 * `observed` date and the gauge already pulls daily candles. This joins them.
 *
 *   event lands, price moves beyond the normal daily band  → absorbed
 *   event lands, price sits inside the noise band          → not yet reflected
 *   no candle for that date, or the event predates the window → unknown
 *
 * Measurement only. Callers decide what it means.
 */

import type { Candle } from "./market-test";

export type EventReaction = {
  observed: string;
  /** Close-to-close move on the session containing the event, percent. */
  movePct: number | null;
  /** Typical absolute daily move over the window, percent. */
  bandPct: number;
  /** Move relative to the band. 1.0 = exactly a normal day. */
  ratio: number | null;
  reaction: "absorbed" | "muted" | "unknown";
  line: string;
};

function typicalDailyMove(candles: Candle[]): number {
  const moves: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    const cur = candles[i]!.close;
    if (prev > 0) moves.push(Math.abs((cur - prev) / prev) * 100);
  }
  if (moves.length === 0) return 0;
  moves.sort((a, b) => a - b);
  // Median, not mean: one earnings gap should not redefine "normal".
  const mid = Math.floor(moves.length / 2);
  return moves.length % 2 === 0 ? (moves[mid - 1]! + moves[mid]!) / 2 : moves[mid]!;
}

/** Did the price react on the day this event was observed? */
export function reactionOn(observed: string, candles: Candle[]): EventReaction {
  const band = Number(typicalDailyMove(candles).toFixed(2));
  const day = Date.parse(observed);
  if (!Number.isFinite(day) || candles.length < 3) {
    return {
      observed,
      movePct: null,
      bandPct: band,
      ratio: null,
      reaction: "unknown",
      line: `${observed}: no candle coverage, reaction unknown.`,
    };
  }

  // Match the session on or immediately after the observation date. News on a
  // Saturday is priced on Monday, so this looks forward, never backward.
  let idx = -1;
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i]!.time;
    if (t >= day) {
      idx = i;
      break;
    }
  }
  if (idx <= 0) {
    return {
      observed,
      movePct: null,
      bandPct: band,
      ratio: null,
      reaction: "unknown",
      line: `${observed}: outside the price window, reaction unknown.`,
    };
  }

  const prev = candles[idx - 1]!.close;
  const cur = candles[idx]!.close;
  if (!(prev > 0)) {
    return {
      observed,
      movePct: null,
      bandPct: band,
      ratio: null,
      reaction: "unknown",
      line: `${observed}: unusable candle, reaction unknown.`,
    };
  }

  const movePct = Number((((cur - prev) / prev) * 100).toFixed(2));
  const ratio = band > 0 ? Number((Math.abs(movePct) / band).toFixed(2)) : null;
  // 1.5x the median day is the threshold: enough to separate a real repricing
  // from ordinary drift without demanding a gap.
  const absorbed = ratio !== null && ratio >= 1.5;
  return {
    observed,
    movePct,
    bandPct: band,
    ratio,
    reaction: absorbed ? "absorbed" : "muted",
    line: absorbed
      ? `${observed}: price moved ${movePct > 0 ? "+" : ""}${movePct}% against a typical ±${band}% day (${ratio}x). The tape reacted.`
      : `${observed}: price moved ${movePct > 0 ? "+" : ""}${movePct}% against a typical ±${band}% day${ratio !== null ? ` (${ratio}x)` : ""}. Inside the noise band, no visible reaction.`,
  };
}

export type PricedInJudgment = {
  verdict: "underpriced" | "priced" | "overpriced" | "unclear";
  reason: string;
  reactions: EventReaction[];
};

/**
 * Judge the whole evidence set. Dated events, the candles for the watched name,
 * and the range position; no confidence number anywhere.
 */
export function judgePricedIn(params: {
  observedDates: string[];
  candles: Candle[];
  /** Where price sits in its recent range, 0-100. */
  rangePos?: number | null;
}): PricedInJudgment {
  const { observedDates, candles, rangePos } = params;
  const dates = Array.from(new Set(observedDates.filter(Boolean))).sort().slice(-12);

  if (candles.length < 5 || dates.length === 0) {
    return {
      verdict: "unclear",
      reason:
        candles.length < 5
          ? "No usable price history for the watched name, so whether the market absorbed these events cannot be measured."
          : "No dated events to test against the tape.",
      reactions: [],
    };
  }

  const reactions = dates.map((d) => reactionOn(d, candles));
  const testable = reactions.filter((r) => r.reaction !== "unknown");
  if (testable.length === 0) {
    return {
      verdict: "unclear",
      reason: "Every event falls outside the price window, so no reaction could be measured.",
      reactions,
    };
  }

  const absorbed = testable.filter((r) => r.reaction === "absorbed").length;
  const share = absorbed / testable.length;
  const high = typeof rangePos === "number" && rangePos >= 80;
  const low = typeof rangePos === "number" && rangePos <= 30;

  if (share >= 0.5) {
    return {
      verdict: "priced",
      reason: `${absorbed} of ${testable.length} dated events landed with a move beyond the normal daily band, so the tape has been reacting as this news arrived.${high ? " Price also sits near the top of its range." : ""}`,
      reactions,
    };
  }
  if (share === 0 && low) {
    return {
      verdict: "underpriced",
      reason: `None of the ${testable.length} dated events produced a move beyond the noise band, and price sits in the lower third of its range. The market has not visibly responded.`,
      reactions,
    };
  }
  if (share === 0 && high) {
    return {
      verdict: "overpriced",
      reason: `None of the ${testable.length} dated events produced a measurable move, yet price sits near the top of its range. The strength is coming from something other than this evidence.`,
      reactions,
    };
  }
  if (share === 0) {
    return {
      verdict: "underpriced",
      reason: `None of the ${testable.length} dated events produced a move beyond the normal daily band, so this evidence does not appear to be reflected yet.`,
      reactions,
    };
  }
  return {
    verdict: "unclear",
    reason: `Only ${absorbed} of ${testable.length} dated events moved the price beyond its noise band. The reaction is too mixed to call.`,
    reactions,
  };
}
