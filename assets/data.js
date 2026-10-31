// Pure data helpers for the public page: no DOM, no fetch.

const DAY_MS = 86400000;
const COUNT_KEY = { happiness: "happiness_words", entropy: "entropy_tokens" };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Days since 1970-01-01 UTC for an ISO date string.
export const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

// ISO date string for a day number (inverse of dayNumber).
export const isoFromDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

// One point per listed day for a meter; value is null when missing.
export function toSeries(daily, meter) {
  const values = daily[meter] || [];
  const counts = daily[COUNT_KEY[meter]] || [];
  return daily.dates.map((date, i) => ({
    date,
    x: dayNumber(date),
    value: isNum(values[i]) ? values[i] : null,
    partial: daily.coverage[i] === "partial",
    gapHours: daily.gap_hours[i] || [],
    posts: daily.posts[i],
    count: counts[i] ?? null,
  }));
}

// Runs of indices with values, broken at nulls and at jumps of more than one day.
export function segments(series) {
  const runs = [];
  let run = [];
  series.forEach((p, i) => {
    if (p.value === null) { run = []; return; }
    if (run.length && p.x - series[run[run.length - 1]].x > 1) run = [];
    if (!run.length) runs.push(run);
    run.push(i);
  });
  return runs;
}

// Mean of non-null values in the n calendar days before point i, or null.
export function trailingMean(series, i, n = 7) {
  const x = series[i].x;
  const vals = series
    .filter((p) => p.value !== null && p.x >= x - n && p.x <= x - 1)
    .map((p) => p.value);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// X range for the last N days (30, 90) or everything ("all"), ending at the last x.
export function xDomain(series, range) {
  const first = series[0].x;
  const last = series[series.length - 1].x;
  if (first === last) return [first - 1, last + 1];
  if (range === "all") return [first, last];
  return [Math.max(first, last - (range - 1)), last];
}

// Y range with 25% padding and a minimum span of 0.05, or null without finite values.
export function yDomain(values) {
  const v = values.filter(isNum);
  if (!v.length) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pad = (hi - lo) * 0.25;
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2 + pad, 0.025);
  return [mid - half, mid + half];
}

// Index of the point whose x is closest to the given x (ties go earlier).
export function nearestIndex(series, x) {
  let best = 0;
  series.forEach((p, i) => {
    if (Math.abs(p.x - x) < Math.abs(series[best].x - x)) best = i;
  });
  return best;
}

// 24 hourly points; value is null unless the hour is complete and finite.
export function hourly(dayFile, meter) {
  const hours = dayFile[meter]?.hours || [];
  return dayFile.hour_states.map((state, hour) => ({
    hour,
    value: state === "complete" && isNum(hours[hour]) ? hours[hour] : null,
    state,
  }));
}

// A valid {lang, meter, date, range, theme} derived from a possibly stale state.
export function reconcile(state, index, series) {
  const langs = index.languages;
  const lang = langs.find((l) => l.code === state.lang)
    || langs.find((l) => l.code === "en") || langs[0];
  const meter = lang.meters.includes(state.meter) ? state.meter : lang.meters[0];
  let date = state.date;
  if (series.length) {
    // Prefer days that have a value; fall back to every day when none does.
    const valued = series.filter((p) => p.value !== null);
    const pool = valued.length ? valued : series;
    const wanted = state.date && series.find((p) => p.date === state.date);
    if (wanted && wanted.value !== null) date = wanted.date;
    else if (state.date) date = pool[nearestIndex(pool, dayNumber(state.date))].date;
    else date = pool[pool.length - 1].date;
  }
  return { lang: lang.code, meter, date, range: state.range ?? 90, theme: state.theme ?? "auto" };
}

// Page heading for a meter.
export const pageTitle = (meter) =>
  meter === "entropy" ? "Bluesky Entropometer" : "Bluesky Hedonometer";

// Page subtitle for a meter.
export const subtitle = (meter) => meter === "entropy"
  ? "How predictable the language of Bluesky is, day by day, from every public post."
  : "How happy the language of Bluesky is, day by day, from every public post.";

// Compact count with 3 significant figures: 1.98M, 836K, 12.3K, 950.
export function formatCount(n) {
  const short = (v, unit) => `${Number(v.toPrecision(3))}${unit}`;
  if (n >= 999500) return short(n / 1e6, "M");
  if (n >= 1000) return short(n / 1e3, "K");
  return String(n);
}

// "day" or "night" from the preference and the system dark-mode flag.
export const resolveTheme = (pref, systemDark) =>
  pref === "day" || pref === "night" ? pref : (systemDark ? "night" : "day");

// Relative URL of a day's word-shift file.
export const shiftUrl = (lang, date) => `data/${lang}/shifts/${date}.json`;

// Hero line for a selected day that has no value.
export const NO_SCORE_MESSAGE = "Not enough words on this day for a score.";

// Explanation to show instead of a word shift, or null when there is nothing to explain.
// hasValue false: the selected day has no value, so there is no shift to fetch.
export function shiftMessage(meter, status, hasValue = true) {
  if (meter === "entropy") {
    return "Word shifts are a happiness feature. Switch to Happiness to see which words moved the day.";
  }
  if (!hasValue) return "Not enough words on this day for a word shift.";
  if (status === 404) {
    return "No word shift for this day: it needs at least one earlier day to compare against.";
  }
  return null;
}

// Word type -> colour slot: raised happiness (pos) or lowered (neg); "less of" is the pale shade.
// A "_counteracted" type takes its base type's colour (wordlevel fades it with fillOpacity).
const SHIFT_SLOTS = {
  more_of_positive: "pos", higher_score: "pos", less_of_negative: "posPale",
  more_of_negative: "neg", lower_score: "neg", less_of_positive: "negPale", total: "muted",
};
const GREY_KEYS = new Set(["color", "stroke", "domainColor", "tickColor"]);

// A copy of a wordlevel Vega-Lite spec in the page's colours, with each view's width set to `width`.
// tokens: {ink, muted, pos, posPale, neg, negPale}.
export function themeShift(spec, tokens, width) {
  const walk = (node, key) => {
    if (Array.isArray(node)) return node.map((v) => walk(v, key));
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, k);
      const { domain, range } = out;
      if (key === "scale" && Array.isArray(domain) && Array.isArray(range)) {
        out.range = range.map((c, i) => (typeof c === "string" ? tokens[SHIFT_SLOTS[String(domain[i]).replace(/_counteracted$/, "")]] ?? c : c));
      }
      if (typeof out.width === "number" && isNum(width)) out.width = width;
      return out;
    }
    if (key === "color" && node === "black") return tokens.ink;
    if (GREY_KEYS.has(key) && node === "#888") return tokens.muted;
    return node;
  };
  return walk(spec, null);
}
