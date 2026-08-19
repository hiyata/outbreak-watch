// Turns a chronological value series into a growth-rate + trend summary.
// Shared by every fetch script so "rising/falling/stable" means the same
// thing everywhere in the dashboard, regardless of source shape.
//
// Classification uses a trailing linear-regression slope rather than a
// last-two-points comparison, so a single noisy week doesn't flip the
// label back and forth. It is a descriptive read of the recent series,
// not an epidemiological model — no serial interval, no Rt.

const TREND_WINDOW = 4; // trailing points the slope is fit over
const MIN_POINTS_FOR_TREND = 3; // fewer than this -> "insufficient_data"
const FLAT_THRESHOLD = 0.1; // |slope| below 10% of the window's mean reads as "stable"

/**
 * @param {Array<{value: number|null}>} points chronological, oldest first
 * @param {{cumulative?: boolean}} opts set cumulative:true for running-total
 *   series (e.g. WHO's cumulative case counts) so growth is computed on the
 *   first-differenced (incident) values, not the ever-increasing total.
 */
export function computeTrend(points, { cumulative = false } = {}) {
  const clean = (points || []).filter((p) => p && p.value !== null && Number.isFinite(p.value));
  if (clean.length < 2) return null;

  const series = cumulative ? toIncident(clean) : clean;
  if (series.length < 2) return null;

  const latest = series[series.length - 1];
  const previous = series[series.length - 2];
  const absoluteChange = round(latest.value - previous.value, 2);
  const percentChange = previous.value === 0 ? null : round((absoluteChange / Math.abs(previous.value)) * 100, 1);

  const window = series.slice(-TREND_WINDOW);
  const trend = classify(window);

  return {
    latest_value: round(latest.value, 2),
    previous_value: round(previous.value, 2),
    absolute_change: absoluteChange,
    percent_change: percentChange,
    trend,
    window_size: window.length,
  };
}

function toIncident(cumulativeSeries) {
  // First-difference a running total into per-period values. A negative
  // result is a real downward revision, not something to clamp to zero.
  const out = [];
  for (let i = 1; i < cumulativeSeries.length; i++) {
    out.push({ value: cumulativeSeries[i].value - cumulativeSeries[i - 1].value });
  }
  return out;
}

function classify(window) {
  if (window.length < MIN_POINTS_FOR_TREND) return "insufficient_data";
  const values = window.map((p) => p.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const slope = linearRegressionSlope(values);
  if (mean === 0) return slope > 0 ? "rising" : slope < 0 ? "falling" : "stable";
  const relativeSlope = slope / Math.abs(mean);
  if (relativeSlope > FLAT_THRESHOLD) return "rising";
  if (relativeSlope < -FLAT_THRESHOLD) return "falling";
  return "stable";
}

function linearRegressionSlope(values) {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
