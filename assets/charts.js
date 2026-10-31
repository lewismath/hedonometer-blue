// SVG drawing only. Colours come from CSS custom properties, read at draw time.
import { segments, yDomain, nearestIndex, isoFromDay } from "./data.js";

const NS = "http://www.w3.org/2000/svg";
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function text(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, "font-size": 11, fill: css("--ink-3"), ...attrs }, parent);
  t.textContent = str;
  return t;
}

// Remove a host's previous drawing (svg and empty state), keeping its tooltip.
function clear(host) {
  host.querySelectorAll(":scope > svg, :scope > .empty").forEach((n) => n.remove());
}

function emptyState(host, message) {
  clear(host);
  const d = document.createElement("div");
  d.className = "empty";
  d.textContent = message;
  host.prepend(d);
}

function tooltip(host) {
  let tip = host.querySelector(":scope > .tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "status");
    host.appendChild(tip);
  }
  tip.style.opacity = 0;
  return tip;
}

// Place a tooltip at (px, py) in host pixels, kept inside the host horizontally.
function placeTip(tip, host, px, py, html) {
  tip.innerHTML = html;
  const w = tip.offsetWidth;
  const left = Math.max(w / 2, Math.min(host.clientWidth - w / 2, px));
  tip.style.left = `${left}px`;
  tip.style.top = `${py}px`;
  tip.style.opacity = 1;
}

const fmtOpts = { timeZone: "UTC" };
const asDate = (iso) => new Date(`${iso}T00:00:00Z`);
// "30 Oct 2026"
export const fmtDate = (iso) =>
  asDate(iso).toLocaleDateString("en-AU", { ...fmtOpts, day: "numeric", month: "short", year: "numeric" });
// "30 Oct"
export const fmtShort = (iso) =>
  asDate(iso).toLocaleDateString("en-AU", { ...fmtOpts, day: "numeric", month: "short" });

// Round tick values inside [lo, hi]: the widest round step giving at least `count` ticks.
function niceTicks(lo, hi, count) {
  const mag = 10 ** Math.floor(Math.log10(hi - lo));
  const steps = [5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1, 0.05].map((k) => k * mag);
  const at = (step) => {
    const ticks = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(v);
    return ticks;
  };
  const step = steps.find((s) => at(s).length >= count) || steps[steps.length - 1];
  // Decimals needed to show the step exactly (0.025 -> 3), at least 2.
  let decimals = 2;
  while (decimals < 6 && Math.abs(Math.round(step * 10 ** decimals) - step * 10 ** decimals) > 1e-6) decimals++;
  return { ticks: at(step), decimals };
}

function yAxis(svg, m, W, y, lo, hi, count) {
  const { ticks, decimals } = niceTicks(lo, hi, count);
  for (const t of ticks) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: css("--grid") }, svg);
    text(svg, m.l - 8, y(t) + 4, t.toFixed(decimals), { "text-anchor": "end", class: "num" });
  }
}

// Line paths for each run of consecutive values (never bridging a gap).
function runsPath(points, x, y) {
  return points.map((p, k) => `${k ? "L" : "M"}${x(p.x)},${y(p.value)}`).join("");
}

function tipHtml(p, unit) {
  const value = p.value === null ? "<b>no data</b>" : `<b>${p.value.toFixed(3)}</b>${unit}`;
  return `${fmtDate(p.date)}<br>${value}${p.partial ? "<br>missing hours" : ""}`;
}

/**
 * Daily line chart.
 * series: toSeries() points; domain: [x0, x1] in day numbers (inclusive).
 * opts: {domain, selectedX, onHover(point|null), onSelect(point), unit, label}
 */
export function drawMain(host, series, opts) {
  const { domain, selectedX, onHover, onSelect, unit = "", label = "Daily values" } = opts;
  const [d0, d1] = domain;
  const visible = series.filter((p) => p.x >= d0 && p.x <= d1);
  const yd = yDomain(visible.map((p) => p.value));
  if (!yd) { emptyState(host, "No data in this range."); return; }
  clear(host);
  const tip = tooltip(host);

  const W = host.clientWidth || 600;
  const H = Math.round(Math.max(220, Math.min(320, W * 0.42)));
  const m = { l: 44, r: 12, t: 10, b: 24 };
  // Half a day of padding each side, so each day owns a full-width slot.
  const x0 = d0 - 0.5, x1 = d1 + 0.5;
  const [lo, hi] = yd;
  const pw = W - m.l - m.r;
  const x = (v) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const base = H - m.b;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": `${label}, line chart` });
  host.prepend(svg);
  const clipId = `clip-${host.id}`;
  el("rect", { x: m.l, y: 0, width: pw, height: H }, el("clipPath", { id: clipId }, el("defs", {}, svg)));

  // Faint band on each missing day (not listed, or no value) inside the data's span.
  const first = series[0].x, last = series[series.length - 1].x;
  const byX = new Map(series.map((p) => [p.x, p]));
  const dayW = pw / (x1 - x0);
  for (let d = Math.max(d0, first); d <= Math.min(d1, last); d++) {
    const p = byX.get(d);
    if (!p || p.value === null) {
      el("rect", { x: x(d) - dayW / 2, y: m.t, width: Math.max(4, dayW), height: base - m.t, fill: css("--surface-2") }, svg);
    }
  }

  yAxis(svg, m, W, y, lo, hi, 4);

  // X labels: whole days, stepped to fit, always including the last day of the window.
  const span = d1 - d0 + 1;
  const maxLabels = Math.max(2, Math.floor(pw / 64));
  const step = [1, 2, 7, 14, 28, 56, 91, 182, 364].find((s) => Math.ceil(span / s) <= maxLabels) || 364;
  for (let d = Math.min(d1, last); d >= Math.max(d0, first); d -= step) {
    text(svg, x(d), H - 6, fmtShort(isoFromDay(d)), { "text-anchor": "middle" });
  }

  const g = el("g", { "clip-path": `url(#${clipId})` }, svg);
  const line = css("--line");
  for (const run of segments(series)) {
    const pts = run.map((i) => series[i]);
    const d = runsPath(pts, x, y);
    el("path", { d: `${d}L${x(pts[pts.length - 1].x)},${base}L${x(pts[0].x)},${base}Z`, fill: css("--line-soft") }, g);
    el("path", { d, fill: "none", stroke: line, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
    if (pts.length === 1 && !pts[0].partial) el("circle", { cx: x(pts[0].x), cy: y(pts[0].value), r: 4, fill: line }, g);
  }
  for (const p of visible) {
    if (p.partial && p.value !== null) {
      el("circle", { cx: x(p.x), cy: y(p.value), r: 4.5, fill: css("--bg"), stroke: line, "stroke-width": 2 }, g);
    }
  }
  const sel = visible.find((p) => p.x === selectedX);
  if (sel && sel.value !== null) {
    el("line", { x1: x(sel.x), x2: x(sel.x), y1: m.t, y2: base, stroke: css("--ink-3"), "stroke-dasharray": "3 3" }, svg);
    el("circle", {
      cx: x(sel.x), cy: y(sel.value), r: 6,
      fill: sel.partial ? css("--bg") : line, stroke: sel.partial ? line : css("--bg"), "stroke-width": 2,
    }, svg);
  }

  // Hover layer: crosshair, focus dot, tooltip. Pointer events, so touch and pen work too.
  const hx = el("line", { y1: m.t, y2: base, stroke: css("--ink-3"), opacity: 0 }, svg);
  const hd = el("circle", { r: 5, fill: line, stroke: css("--bg"), "stroke-width": 2, opacity: 0 }, svg);
  const hit = el("rect", { x: m.l, y: 0, width: pw, height: H, fill: "transparent", class: "hit" }, svg);
  const pointAt = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    return visible[nearestIndex(visible, x0 + ((px - m.l) / pw) * (x1 - x0))];
  };
  const hide = () => {
    tip.style.opacity = 0; hx.setAttribute("opacity", 0); hd.setAttribute("opacity", 0);
    onHover?.(null);
  };
  hit.addEventListener("pointermove", (e) => {
    const p = pointAt(e);
    const r = svg.getBoundingClientRect();
    const k = r.width / W;
    hx.setAttribute("x1", x(p.x)); hx.setAttribute("x2", x(p.x)); hx.setAttribute("opacity", 0.5);
    if (p.value !== null) {
      hd.setAttribute("cx", x(p.x)); hd.setAttribute("cy", y(p.value)); hd.setAttribute("opacity", 1);
    } else hd.setAttribute("opacity", 0);
    placeTip(tip, host, x(p.x) * k, (p.value === null ? H / 2 : y(p.value)) * k, tipHtml(p, unit));
    onHover?.(p);
  });
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("click", (e) => onSelect?.(pointAt(e)));
}

/**
 * Overview strip with a draggable window over the whole series.
 * opts: {domain: [x0, x1], onChange([x0, x1]) while dragging}
 */
export function drawBrush(host, series, { domain, onChange }) {
  host.replaceChildren();
  if (!series.length) return;
  const W = host.clientWidth || 600, H = 44, m = { l: 44, r: 12 };
  const first = series[0].x, last = series[series.length - 1].x;
  const x0 = first - 0.5, x1 = last + 0.5;
  const pw = W - m.l - m.r;
  const x = (v) => m.l + ((v - x0) / (x1 - x0)) * pw;
  const yd = yDomain(series.map((p) => p.value));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, "aria-label": "Overview; drag the window to move it" }, host);
  el("rect", { x: m.l, y: 0, width: pw, height: H, rx: 8, fill: css("--surface-2") }, svg);
  if (yd) {
    const y = (v) => 6 + (1 - (v - yd[0]) / (yd[1] - yd[0])) * (H - 12);
    for (const run of segments(series)) {
      const pts = run.map((i) => series[i]);
      if (pts.length === 1) el("circle", { cx: x(pts[0].x), cy: y(pts[0].value), r: 2, fill: css("--ink-3") }, svg);
      else el("path", { d: runsPath(pts, x, y), fill: "none", stroke: css("--ink-3"), "stroke-width": 1.5, "stroke-linejoin": "round" }, svg);
    }
  }
  // The window, clipped to the data (a one-day domain is padded beyond it).
  let start = Math.max(domain[0], first);
  const len = Math.min(domain[1], last) - start;
  const win = el("rect", {
    y: 1, height: H - 2, rx: 7, width: Math.max(6, x(start + len + 0.5) - x(start - 0.5)),
    fill: css("--line-soft"), stroke: css("--line"), "stroke-width": 1.5,
  }, svg);
  win.setAttribute("x", x(start - 0.5));

  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    const r = svg.getBoundingClientRect();
    drag = { cx: e.clientX, s0: start, k: W / r.width };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const days = Math.round((((e.clientX - drag.cx) * drag.k) / pw) * (x1 - x0));
    const s = Math.max(first, Math.min(last - len, drag.s0 + days));
    if (s === start) return;
    start = s;
    win.setAttribute("x", x(start - 0.5));
    onChange?.([start, start + len]);
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    svg.classList.remove("dragging");
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
}

const hh = (h) => `${String(h).padStart(2, "0")}:00`;

/**
 * Hourly curve for one day. rows: hourly() output (24 rows, value null for gaps).
 * opts: {selectedHour, onSelect(hour), unit}
 */
export function drawHourly(host, rows, { selectedHour = null, onSelect, unit = "" } = {}) {
  const yd = yDomain(rows.map((r) => r.value));
  if (!yd) { emptyState(host, "No hourly values for this day."); return; }
  clear(host);
  const tip = tooltip(host);
  const W = host.clientWidth || 400, H = 200, m = { l: 44, r: 14, t: 10, b: 22 };
  const pw = W - m.l - m.r;
  const [lo, hi] = yd;
  const x = (h) => m.l + (h / 23) * pw;
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": "Hourly values, UTC" });
  host.prepend(svg);
  yAxis(svg, m, W, y, lo, hi, 3);
  [0, 6, 12, 18, 23].forEach((h) => {
    const anchor = h === 23 ? "end" : h === 0 ? "start" : "middle";
    text(svg, x(h) + (h === 23 ? 6 : h === 0 ? -6 : 0), H - 5, hh(h), { "text-anchor": anchor });
  });
  const line = css("--line");
  // Runs of consecutive non-null hours; a null hour is a gap.
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      el("path", {
        d: run.map((r, k) => `${k ? "L" : "M"}${x(r.hour)},${y(r.value)}`).join(""),
        fill: "none", stroke: line, "stroke-width": 2, "stroke-linejoin": "round",
      }, svg);
    }
    run = [];
  };
  rows.forEach((r) => (r.value === null ? flush() : run.push(r)));
  flush();
  if (selectedHour !== null) {
    el("line", { x1: x(selectedHour), x2: x(selectedHour), y1: m.t, y2: H - m.b, stroke: css("--ink-3"), "stroke-dasharray": "3 3" }, svg);
  }
  const dots = rows.map((r) => (r.value === null ? null : el("circle", {
    cx: x(r.hour), cy: y(r.value), r: r.hour === selectedHour ? 6 : 4, fill: line,
    stroke: r.hour === selectedHour ? css("--bg") : "none", "stroke-width": 2,
  }, svg)));
  const hit = el("rect", { x: m.l - 8, y: 0, width: pw + 16, height: H, fill: "transparent", class: "hit" }, svg);
  const hourAt = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    return Math.max(0, Math.min(23, Math.round(((px - m.l) / pw) * 23)));
  };
  hit.addEventListener("pointermove", (e) => {
    const h = hourAt(e);
    dots.forEach((c, k) => c && k !== selectedHour && c.setAttribute("r", k === h ? 5.5 : 4));
    const v = rows[h].value;
    const k = svg.getBoundingClientRect().width / W;
    placeTip(tip, host, x(h) * k, (v === null ? H / 2 : y(v)) * k,
      `${hh(h)} UTC<br>${v === null ? "<b>missing</b>" : `<b>${v.toFixed(3)}</b>${unit}`}`);
  });
  hit.addEventListener("pointerleave", () => {
    tip.style.opacity = 0;
    dots.forEach((c, k) => c && k !== selectedHour && c.setAttribute("r", 4));
  });
  hit.addEventListener("click", (e) => onSelect?.(hourAt(e)));
}

/** 30-day sparkline ending at day x, with a dot on day x. */
export function drawSpark(host, series, x) {
  host.replaceChildren();
  const pts = series.filter((p) => p.x <= x && p.x >= x - 29);
  const yd = yDomain(pts.map((p) => p.value));
  if (!yd) return;
  const W = host.clientWidth || 300, H = 48;
  const start = Math.min(x - 1, Math.max(x - 29, pts[0].x));
  const sx = (v) => 4 + ((v - start) / (x - start)) * (W - 10);
  const sy = (v) => 6 + (1 - (v - yd[0]) / (yd[1] - yd[0])) * (H - 12);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": "Last 30 days" }, host);
  const line = css("--line");
  for (const run of segments(pts)) {
    const r = run.map((i) => pts[i]);
    el("path", { d: runsPath(r, sx, sy), fill: "none", stroke: line, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  }
  const cur = pts.find((p) => p.x === x);
  if (cur && cur.value !== null) el("circle", { cx: sx(x), cy: sy(cur.value), r: 4, fill: line }, svg);
}
