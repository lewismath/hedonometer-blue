// State, fetching, controls, theme and word-shift embedding. Drawing lives in charts.js.
import {
  dayNumber, toSeries, trailingMean, xDomain, hourly, reconcile, pageTitle, subtitle,
  formatCount, resolveTheme, shiftUrl, shiftMessage, themeShift,
} from "./data.js";
import { drawMain, drawBrush, drawHourly, drawSpark, fmtDate } from "./charts.js";

const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
};
const mq = matchMedia("(prefers-color-scheme: dark)");

let index = null;
let series = [];
let state = { theme: store.get("theme") || "auto" };
let win = null;          // brush-dragged window [x0, x1], or null to follow the range buttons
let selectedHour = null;
let dayFile = null;      // the selected day's days/<date>.json: null while loading, false if unavailable
let shift = null;        // {url, status, spec} for the selected day
let langToken = 0;       // guards against out-of-order language loads
let dayToken = 0;        // guards against out-of-order day loads (never cancels a language load)
let langPending = false; // while true, the visible chart is the previous language: ignore day picks

// ---------- fetching (each URL fetched once) ----------
const cache = new Map();
function getJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null }))
      .catch(() => ({ status: 0, body: null })));
  }
  return cache.get(url);
}

// ---------- helpers ----------
const lang = () => index.languages.find((l) => l.code === state.lang);
const isHappy = () => state.meter === "happiness";
const unit = () => (isHappy() ? "" : " bits/word");
const selIndex = () => series.findIndex((p) => p.date === state.date);
const domain = () => win || xDomain(series, state.range);

function setEmpty(host, message) {
  host.replaceChildren();
  const d = document.createElement("div");
  d.className = "empty";
  d.textContent = message;
  host.appendChild(d);
}

// ---------- loading ----------
async function loadLanguage() {
  const my = ++langToken;
  langPending = true;
  state = reconcile(state, index, []);
  const { body } = await getJSON(`data/${state.lang}/daily.json`);
  if (my !== langToken) return;
  langPending = false;
  series = body && Array.isArray(body.dates) ? toSeries(body, state.meter) : [];
  state = reconcile(state, index, series);
  if (!series.length) state.date = null;
  await loadDay();
}

async function loadDay() {
  const my = ++dayToken;
  dayFile = null;
  shift = null;
  render();
  if (!state.date) return;
  const date = state.date, code = state.lang;
  const url = shiftUrl(code, date);
  const [day, sh] = await Promise.all([
    getJSON(`data/${code}/days/${date}.json`),
    isHappy() ? getJSON(url) : Promise.resolve(null),
  ]);
  if (my !== dayToken) return;
  dayFile = day.body && Array.isArray(day.body.hour_states) ? day.body : false;
  shift = sh ? { url, status: sh.status, spec: sh.body } : null;
  renderDay();
}

// ---------- rendering ----------
function render() {
  if (!index) return;
  renderHeader();
  renderHero();
  renderMain();
  renderDay();
}

function renderHeader() {
  const title = pageTitle(state.meter);
  $("#brandTitle").textContent = title;
  document.title = title;
  $("#brandSub").textContent = subtitle(state.meter);
  $("#lang").value = state.lang;
  document.querySelectorAll(".meter button").forEach((b) => {
    b.disabled = !lang().meters.includes(b.dataset.m);
    b.setAttribute("aria-selected", String(b.dataset.m === state.meter));
  });
  document.querySelectorAll(".ranges button").forEach((b) => {
    const r = b.dataset.r === "all" ? "all" : Number(b.dataset.r);
    b.setAttribute("aria-pressed", String(!win && r === state.range));
  });
  const name = lang().name;
  $("#heroLabel").textContent = `${isHappy() ? "Average happiness" : "Entropy rate"} · ${name}`;
  $("#mainTitle").textContent = `${isHappy() ? "Daily happiness" : "Daily entropy rate"} — ${name}`;
  $("#hourTitle").textContent = isHappy() ? "Happiness through the day" : "Entropy through the day";
}

function renderHero() {
  const i = selIndex();
  const p = series[i];
  const stats = $("#stats");
  if (!p) {
    $("#heroVal").textContent = "—";
    $("#heroDelta").textContent = "No data yet";
    $("#spark").replaceChildren();
    stats.replaceChildren();
    $("#heroMeta").replaceChildren();
    return;
  }
  $("#heroVal").textContent = p.value === null ? "—" : p.value.toFixed(2);
  const prev = trailingMean(series, i);
  const delta = $("#heroDelta");
  if (p.value === null) delta.textContent = "No data for this day";
  else if (prev === null) delta.textContent = "No earlier days yet";
  else {
    const d = p.value - prev;
    delta.innerHTML = `<strong>${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(3)}</strong> vs previous days (up to 7)${isHappy() ? "" : " (bits/word)"}`;
  }
  drawSpark($("#spark"), series, p.x);

  const recent = series.filter((q) => q.x <= p.x && q.x >= p.x - 29 && q.value !== null).map((q) => q.value);
  const range = recent.length ? `${Math.min(...recent).toFixed(2)}–${Math.max(...recent).toFixed(2)}` : "—";
  const rows = [
    ["Posts", formatCount(p.posts)],
    [isHappy() ? "Words scored" : "Tokens", p.count === null ? "—" : formatCount(p.count)],
    ["Coverage", `${24 - p.gapHours.length} / 24 h`],
    ["30-day range", range],
  ];
  stats.replaceChildren(...rows.map(([dt, dd]) => {
    const div = document.createElement("div");
    div.innerHTML = "<dt></dt><dd></dd>";
    div.firstChild.textContent = dt;
    div.lastChild.textContent = dd;
    return div;
  }));

  const span = (textContent, className = "") => Object.assign(document.createElement("span"), { textContent, className });
  $("#heroMeta").replaceChildren(...[
    span(fmtDate(p.date)),
    p.partial && span("missing hours", "badge partial"),
    span(isHappy() ? "scale 1–9" : "bits per word"),
  ].filter(Boolean));
}

function renderMain() {
  const host = $("#mainChart");
  const brush = $("#brush");
  if (!series.length) {
    setEmpty(host, "No days published yet for this language.");
    brush.replaceChildren();
    return;
  }
  const opts = {
    selectedX: series[selIndex()]?.x,
    unit: unit(),
    label: $("#mainTitle").textContent,
    onSelect: (p) => selectDate(p.date),
  };
  drawMain(host, series, { ...opts, domain: domain() });
  drawBrush(brush, series, {
    domain: domain(),
    onChange: (d) => {
      win = d;
      drawMain(host, series, { ...opts, domain: d });
      renderHeader();
    },
  });
}

function renderDay() {
  if (!index) return;
  const i = selIndex();
  const p = series[i];
  $("#dayLabel").textContent = p ? fmtDate(p.date) : "";
  $("#prev").disabled = !p || i <= 0;
  $("#next").disabled = !p || i >= series.length - 1;
  const badge = $("#dayBadge");
  badge.hidden = !p;
  if (p) {
    badge.className = `badge${p.partial ? " partial" : ""}`;
    badge.textContent = p.partial ? "missing hours" : "complete day";
  }
  renderHourly();
  renderShift();
}

function renderHourly() {
  const host = $("#hourly");
  if (!state.date) { setEmpty(host, "No data yet."); return; }
  if (dayFile === null) { setEmpty(host, "Loading…"); return; }
  if (!dayFile) { setEmpty(host, "No hourly values for this day."); return; }
  drawHourly(host, hourly(dayFile, state.meter), {
    selectedHour,
    unit: unit(),
    onSelect: (h) => { selectedHour = selectedHour === h ? null : h; renderHourly(); },
  });
}

// ---------- word shift ----------
const hexToRgba = (hex, a) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

function themeConfig() {
  const ink = cssVar("--ink"), ink2 = cssVar("--ink-2"), ink3 = cssVar("--ink-3"), grid = cssVar("--grid");
  return {
    background: null,
    font: "Inter, system-ui, sans-serif",
    axis: { labelColor: ink3, titleColor: ink2, domainColor: ink3, tickColor: ink3, gridColor: grid },
    title: { color: ink },
    text: { color: ink },
    view: { stroke: null },
  };
}

let embedRun = 0;
async function renderShift() {
  const host = $("#shift");
  const legend = $("#shiftLegend");
  const sub = $("#shiftSub");
  const run = ++embedRun;
  const say = (msg) => { legend.hidden = true; sub.hidden = !isHappy(); setEmpty(host, msg); };
  if (!state.date) { say("No data yet."); return; }
  if (!isHappy()) { say(shiftMessage("entropy")); return; }
  if (!shift) { say("Loading…"); return; }
  if (shift.status !== 200 || !shift.spec) {
    say(shiftMessage("happiness", shift.status) || "The word shift could not be loaded.");
    return;
  }
  if (typeof window.vegaEmbed !== "function") { say("The word shift could not be shown."); return; }
  legend.hidden = false;
  sub.hidden = false;
  const pos = cssVar("--pos"), neg = cssVar("--neg");
  const tokens = {
    ink: cssVar("--ink"), muted: cssVar("--ink-3"),
    pos, posPale: hexToRgba(pos, 0.45), neg, negPale: hexToRgba(neg, 0.45),
  };
  const embed = async (width) => {
    const el = document.createElement("div");
    host.replaceChildren(el);
    await window.vegaEmbed(el, themeShift(shift.spec, tokens, width),
      { actions: false, renderer: "svg", config: themeConfig(), logLevel: window.vega?.Error });
    const svg = el.querySelector("svg");
    return svg ? svg.getBoundingClientRect().width - host.clientWidth : 0;
  };
  try {
    // Leave room for the rank axis; shrink once more if the result still overflows the card.
    const width = Math.max(160, Math.min(560, host.clientWidth - 70));
    const over = await embed(width);
    if (run === embedRun && over > 0.5) await embed(Math.floor(width - over - 2));
  } catch (e) {
    if (run === embedRun) say("The word shift could not be shown.");
  }
}

// ---------- selection ----------
function selectDate(date) {
  if (langPending || !date || date === state.date) return;
  state.date = date;
  selectedHour = null;
  // Keep the selected day inside a dragged window.
  if (win) {
    const x = dayNumber(date), len = win[1] - win[0];
    if (x < win[0]) win = [x, x + len];
    if (x > win[1]) win = [x - len, x];
  }
  loadDay();
}

function step(k) {
  const p = series[selIndex() + k];
  if (p) selectDate(p.date);
}

// ---------- theme ----------
function applyTheme() {
  const day = resolveTheme(state.theme, mq.matches) === "day";
  const changed = root.classList.contains("day") !== day;
  root.classList.toggle("day", day);
  document.querySelectorAll(".theme button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.t === state.theme)));
  if (changed) render();
}

// ---------- controls ----------
function wire() {
  const sel = $("#lang");
  sel.replaceChildren(...index.languages.map((l) => Object.assign(document.createElement("option"), { value: l.code, textContent: l.name })));
  sel.addEventListener("change", () => { state.lang = sel.value; win = null; selectedHour = null; loadLanguage(); });
  document.querySelectorAll(".meter button").forEach((b) => b.addEventListener("click", () => {
    if (b.disabled || b.dataset.m === state.meter) return;
    state.meter = b.dataset.m;
    loadLanguage();
  }));
  document.querySelectorAll(".ranges button").forEach((b) => b.addEventListener("click", () => {
    state.range = b.dataset.r === "all" ? "all" : Number(b.dataset.r);
    win = null;
    renderHeader();
    renderMain();
  }));
  $("#prev").addEventListener("click", () => step(-1));
  $("#next").addEventListener("click", () => step(1));
  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;   // ignore mobile toolbar height changes
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });
}

document.querySelectorAll(".theme button").forEach((b) => b.addEventListener("click", () => {
  state.theme = b.dataset.t;
  store.set("theme", state.theme);
  applyTheme();
}));
mq.addEventListener("change", applyTheme);
applyTheme();

async function init() {
  const { body } = await getJSON("data/index.json");
  if (!body || !Array.isArray(body.languages) || !body.languages.length) {
    setEmpty($("#mainChart"), "The data could not be loaded.");
    return;
  }
  index = body;
  $("#updated").textContent = `Updated through ${index.end}`;
  wire();
  await loadLanguage();
}

// Module scripts run after the deferred vega scripts, in document order, so vegaEmbed is ready here.
init();
