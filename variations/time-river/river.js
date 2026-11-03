// Time River: the Atlas as a watershed in time.
// x = publication year, width of a stream = papers per year (3-year moving average),
// four channels = the four concept types. Flat on purpose: depth comes from opening channels.
(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let atlas;
  try {
    atlas = await AtlasCore.load();
  } catch (e) {
    $("#empty").hidden = false;
    $("#empty").innerHTML = `<b>Could not load the Atlas</b>${String(e.message || e)}`;
    return;
  }
  const { esc, plural, paperTitle } = atlas.text;
  const Y0 = atlas.Y0, Y1 = atlas.Y1;
  const TYPES = atlas.types;
  const TOP_N = 12;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DUR = reduceMotion ? 0 : 720;
  const yearsWithPapers = new Set(atlas.papers.map((p) => p.year));
  const typeColor = (id) => atlas.colorOf(id);
  const typeObj = (id) => atlas.typeOf(id);
  const fmtPct = (v) => `${Math.round(v * 100)}%`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- State ----------
  const state = {
    filter: atlas.defaultFilter(),
    route: {},
    tab: "all",
    showAllConn: false,
    showAllPapers: false,
    navCount: 0,
    lastKey: ""
  };

  // ---------- Routing ----------
  // #/                 watershed
  // #/task[/all]       a channel (all = every stream, small ones unmerged)
  // #/c/<id>           a concept
  // #/c/<id>/w/<id2>   a connection
  // .../p/<paperId>    a paper (keeps the concept / connection context)
  // ?y=1995-2010&m=3&h=subject   filters
  const paperKey = (s) => (atlas.paperById.has(Number(s)) ? Number(s) : atlas.paperById.has(s) ? s : null);
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = h.split("?");
    const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
    const r = { channel: null, all: false, concept: null, other: null, paper: null };
    for (let i = 0; i < seg.length; i++) {
      const s = seg[i];
      if (s === "c") r.concept = seg[++i];
      else if (s === "w") r.other = seg[++i];
      else if (s === "p") r.paper = seg[++i];
      else if (s === "all") r.all = true;
      else if (TYPES.some((t) => t.id === s)) r.channel = s;
    }
    if (r.concept && !atlas.byId.has(r.concept)) r.concept = null;
    if (r.other && (!r.concept || !atlas.byId.has(r.other) || !atlas.linkBetween(r.concept, r.other))) r.other = null;
    if (r.paper != null) r.paper = paperKey(r.paper);
    if (r.concept) r.channel = atlas.byId.get(r.concept).type;
    return { r, query };
  }
  function filterQuery(f) {
    const q = [];
    if (atlas.rangeActive(f)) q.push(`y=${f.range[0]}-${f.range[1]}`);
    if (f.minPapers > 1) q.push(`m=${f.minPapers}`);
    const hidden = TYPES.filter((t) => !f.types.has(t.id)).map((t) => t.id);
    if (hidden.length) q.push(`h=${hidden.join(",")}`);
    return q.join("&");
  }
  function applyQuery(query) {
    const f = atlas.defaultFilter();
    const p = new URLSearchParams(query);
    const y = (p.get("y") || "").match(/^(\d{4})-(\d{4})$/);
    if (y) {
      let a = clamp(+y[1], Y0, Y1), b = clamp(+y[2], Y0, Y1);
      if (a > b) [a, b] = [b, a];
      if (b - a < 2) b = Math.min(Y1, a + 2), a = b - 2;
      f.range = [a, b];
    }
    if (p.get("m")) f.minPapers = clamp(parseInt(p.get("m"), 10) || 1, 1, 60);
    (p.get("h") || "").split(",").forEach((id) => f.types.delete(id));
    state.filter = f;
  }
  function hashFor(r) {
    const parts = [];
    if (r.concept) {
      parts.push("c", r.concept);
      if (r.other) parts.push("w", r.other);
    } else if (r.channel) {
      parts.push(r.channel);
      if (r.all) parts.push("all");
    }
    if (r.paper != null) parts.push("p", r.paper);
    const q = filterQuery(state.filter);
    return "#/" + parts.map((s) => encodeURIComponent(s)).join("/") + (q ? "?" + q : "");
  }
  function go(r) {
    const h = hashFor(r);
    if (h === location.hash) return;
    state.navCount++;
    location.hash = h;
  }
  const R = {
    home: () => ({}),
    channel: (t, all = false) => ({ channel: t, all }),
    concept: (id) => ({ concept: id }),
    link: (a, b) => ({ concept: a, other: b }),
    paper: (pid, ctx = state.route) => ({ concept: ctx.concept || null, other: ctx.other || null, channel: ctx.concept ? null : ctx.channel, all: ctx.all, paper: pid })
  };
  function parentOf(r) {
    if (r.paper != null) return { ...r, paper: null };
    if (r.other) return { concept: r.concept };
    if (r.concept) return { channel: atlas.byId.get(r.concept).type };
    if (r.channel && r.all) return { channel: r.channel };
    return {};
  }
  function onHash(first) {
    const { r, query } = parseHash();
    if (first) applyQuery(query);
    // A route into a hidden channel turns that channel back on.
    if (r.channel && !state.filter.types.has(r.channel)) state.filter.types.add(r.channel);
    const prevKey = state.lastKey;
    state.route = r;
    const key = `${r.concept || ""}|${r.other || ""}`;
    if (r.concept !== (state.prevConcept || null)) { state.tab = "all"; state.showAllConn = false; }
    if (key !== prevKey) state.showAllPapers = false;
    state.prevConcept = r.concept;
    state.lastKey = key;
    const canonical = hashFor(r);
    if (canonical !== location.hash) history.replaceState(null, "", canonical);
    render(!first);
    if (!first) $("#panel").scrollTop = 0;
  }
  function setFilter(mut, live = false) {
    mut(state.filter);
    const r = state.route;
    if (r.channel && !state.filter.types.has(r.channel)) state.route = {};
    history.replaceState(null, "", hashFor(state.route));
    render(false, live);
  }

  // ---------- Data model for the current filter ----------
  const ma3 = (a) => a.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < a.length) { s += a[j]; n++; }
    return s / n;
  });
  function buildModel() {
    const f = state.filter;
    const [r0, r1] = f.range;
    const years = d3.range(r0, r1 + 1);
    const cache = new Map();
    const S = (node) => {
      let s = cache.get(node.id);
      if (!s) {
        const raw = node.yearCounts.slice(r0 - Y0, r1 - Y0 + 1);
        s = { raw, smooth: ma3(raw), total: d3.sum(raw) };
        cache.set(node.id, s);
      }
      return s;
    };
    const channels = TYPES.filter((t) => f.types.has(t.id)).map((t) => {
      const nodes = atlas.nodes
        .filter((n) => n.type === t.id && atlas.nodeVisible(n, f))
        .sort((a, b) => S(b).total - S(a).total || a.label.localeCompare(b.label));
      const pids = new Set();
      nodes.forEach((n) => atlas.papersIn(n.papers, f).forEach((p) => pids.add(p.paper_id)));
      return { type: t, nodes, paperCount: pids.size };
    });
    const inRange = atlas.papersIn(atlas.papers, f);
    // "Rising": share of a concept's papers in the most recent decade of the range (or last third,
    // for short ranges) against the same share for every paper in range.
    const win = Math.min(10, Math.max(2, Math.ceil((r1 - r0 + 1) / 3)));
    const recentFrom = r1 - win + 1;
    const corpusShare = inRange.length ? inRange.filter((p) => p.year >= recentFrom).length / inRange.length : 0;
    const recentShare = (n) => {
      const s = S(n);
      return s.total ? d3.sum(s.raw.slice(recentFrom - r0)) / s.total : 0;
    };
    const risingOf = (nodes, minN, limit, exclude = new Set()) => nodes
      .filter((n) => !exclude.has(n.id) && S(n).total >= minN)
      .map((n) => ({ node: n, share: recentShare(n), total: S(n).total }))
      .filter((x) => x.share - corpusShare >= 0.15)
      .sort((a, b) => (b.share - corpusShare) * Math.sqrt(b.total) - (a.share - corpusShare) * Math.sqrt(a.total))
      .slice(0, limit);
    const biggest = channels.filter((c) => c.nodes.length).map((c) => ({ node: c.nodes[0], channel: c }));
    const rising = risingOf(channels.flatMap((c) => c.nodes), Math.max(8, f.minPapers), 2, new Set(biggest.map((b) => b.node.id)));
    return { f, r0, r1, years, S, channels, inRange, recentFrom, corpusShare, recentShare, risingOf, biggest, rising };
  }

  // Named streams inside-out (the classic streamgraph look); the merged "smaller streams" band always
  // runs along the bottom bank so it never splits the named streams.
  function orderOtherLast(series) {
    const named = series.map((sr, i) => i).filter((i) => !String(series[i].key).endsWith(":__other"));
    const sub = named.map((i) => series[i]);
    const o = d3.stackOrderInsideOut(sub).map((j) => named[j]);
    series.forEach((sr, i) => { if (!named.includes(i)) o.push(i); });
    return o;
  }
  function streamsFor(m, c, all) {
    const list = all ? c.nodes : c.nodes.slice(0, TOP_N);
    const streams = list.map((n, j) => ({ key: `${c.type.id}:${n.id}`, node: n, type: c.type, rank: j, ...m.S(n) }));
    const rest = all ? [] : c.nodes.slice(TOP_N);
    if (rest.length) {
      const raw = m.years.map((_, i) => d3.sum(rest, (n) => m.S(n).raw[i]));
      streams.push({ key: `${c.type.id}:__other`, other: true, count: rest.length, members: rest, type: c.type, rank: TOP_N, raw, smooth: ma3(raw), total: d3.sum(raw) });
    }
    if (!streams.length) return { streams, env: m.years.map(() => 0), max: 1 };
    const rows = m.years.map((_, i) => {
      const o = {};
      streams.forEach((s) => { o[s.key] = s.smooth[i]; });
      return o;
    });
    const st = d3.stack().keys(streams.map((s) => s.key)).order(orderOtherLast).offset(d3.stackOffsetSilhouette)(rows);
    st.forEach((layer, j) => { streams[j].layer = layer.map((d) => [d[0], d[1]]); });
    const env = m.years.map((_, i) => d3.sum(streams, (s) => s.smooth[i]));
    return { streams, env, max: d3.max(env) || 1 };
  }

  // ---------- SVG scaffolding ----------
  const svg = d3.select("#plot");
  const defs = svg.append("defs");
  TYPES.forEach((t) => {
    const p = defs.append("pattern").attr("id", `hatch-${t.id}`).attr("patternUnits", "userSpaceOnUse").attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
    p.append("rect").attr("width", 6).attr("height", 6).attr("fill", d3.color(t.color).darker(2.2));
    p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", t.color).attr("stroke-width", 1.6).attr("stroke-opacity", 0.45);
  });
  const gGrid = svg.append("g");
  const gBands = svg.append("g");
  const gStreams = svg.append("g");
  const gLanes = svg.append("g");
  const gConf = svg.append("g");
  const gLabels = svg.append("g");
  const gPills = svg.append("g");
  const gHover = svg.append("g");
  const xhair = gHover.append("line").attr("class", "xhair").style("display", "none");
  const xhairLab = gHover.append("text").attr("class", "xhair-lab halo").attr("text-anchor", "middle").style("display", "none");
  const tip = $("#tip");

  const M = { l: 18, r: 22, t: 26, b: 24 };
  let X = d3.scaleLinear(), W = 0, H = 0, years = [], plotTop = 0, plotBot = 0;
  const plotL = () => M.l, plotR = () => W - M.r;

  const mctx = document.createElement("canvas").getContext("2d");
  function textW(s, size = 11, weight = 500, mono = false) {
    mctx.font = `${weight} ${size}px ${mono ? '"IBM Plex Mono"' : '"IBM Plex Sans"'}`;
    return mctx.measureText(s).width;
  }
  const areaGen = (cy, k) => d3.area().x((d, i) => X(years[i])).y0((d) => cy + d[0] * k).y1((d) => cy + d[1] * k).curve(d3.curveBasis);
  // Points of a layer as drawn by curveBasis (at the knots the curve sits at (p[i-1] + 4p[i] + p[i+1]) / 6).
  function basisPts(layer, cy, k) {
    const n = layer.length;
    const at = (j, c) => layer[clamp(j, 0, n - 1)][c];
    return layer.map((_, i) => {
      const b0 = i === 0 || i === n - 1 ? at(i, 0) : (at(i - 1, 0) + 4 * at(i, 0) + at(i + 1, 0)) / 6;
      const b1 = i === 0 || i === n - 1 ? at(i, 1) : (at(i - 1, 1) + 4 * at(i, 1) + at(i + 1, 1)) / 6;
      return { x: X(years[i]), top: cy + b0 * k, bot: cy + b1 * k };
    });
  }
  // Place a label inside the widest stretch of a stream where it fits entirely.
  function fitLabel(layer, cy, k, text, size, weight) {
    const w = textW(text, size, weight) + 8, h = size + 2;
    const pts = basisPts(layer, cy, k);
    const order = d3.range(pts.length).sort((a, b) => (pts[b].bot - pts[b].top) - (pts[a].bot - pts[a].top));
    for (const i of order) {
      if (pts[i].bot - pts[i].top < h) break;
      const ym = (pts[i].top + pts[i].bot) / 2;
      for (const shift of [0, -w / 3, w / 3, -w / 2, w / 2]) {
        const xc = pts[i].x + shift, xa = xc - w / 2, xb = xc + w / 2;
        if (xa < plotL() + 2 || xb > plotR() - 2) continue;
        // check the stream boundary at knots inside the label and interpolated at its ends
        let ok = true;
        const check = (xx) => {
          const j = clamp(Math.floor((xx - pts[0].x) / ((pts[pts.length - 1].x - pts[0].x) / Math.max(1, pts.length - 1))), 0, pts.length - 2);
          const a = pts[j], b = pts[j + 1] || a;
          const t = b.x === a.x ? 0 : clamp((xx - a.x) / (b.x - a.x), 0, 1);
          const top = a.top + (b.top - a.top) * t, bot = a.bot + (b.bot - a.bot) * t;
          return top <= ym - h / 2 + 0.5 && bot >= ym + h / 2 - 0.5;
        };
        for (let xx = xa; xx <= xb + 0.1; xx += Math.max(4, (xb - xa) / 8)) if (!check(xx)) { ok = false; break; }
        if (ok) return { x: xc, y: ym };
      }
    }
    return null;
  }
  function shade(type, rank) {
    const c = d3.hsl(type.color);
    c.l = clamp(c.l + [0, -0.08, 0.06, -0.14, 0.1, -0.04][rank % 6], 0.28, 0.86);
    return c.formatHex();
  }
  const streamFill = (s) => (s.other ? `url(#hatch-${s.type.id})` : shade(s.type, s.rank));

  // ---------- Layouts ----------
  function layout(m) {
    const L = { streams: [], labels: [], bands: [], pills: [], lanes: [], marker: null, empty: null };
    const r = state.route;
    if (!m.channels.length) {
      L.empty = { title: "All channels are hidden", text: "Turn a type back on in the filter row above.", action: "types" };
      return L;
    }
    if (r.concept) layoutConcept(m, L);
    else if (r.channel) layoutChannel(m, L);
    else layoutLanding(m, L);
    // paper marker
    if (r.paper != null) {
      const p = atlas.paperById.get(r.paper);
      if (p && p.year >= m.r0 && p.year <= m.r1) L.marker = { year: p.year, label: `this paper · ${p.year}` };
    }
    return L;
  }

  function channelTitle(L, c, x, y, sub, onClick) {
    L.labels.push({ cls: "ch-title halo", x, y, text: c.type.plural, fill: c.type.color, click: onClick, tip: { t1: c.type.plural, t2: c.type.definition, t3: "Click to open this channel" } });
    L.labels.push({ cls: "ch-sub halo", x: x + textW(c.type.plural.toUpperCase(), 11, 600, true) + c.type.plural.length * 1.2 + 10, y, text: sub });
  }

  function pushStack(L, m, c, st, cy, k, opts) {
    const gen = areaGen(cy, k);
    st.streams.forEach((s) => {
      L.streams.push({
        key: s.key, d: gen(s.layer), fill: streamFill(s), opacity: opts.opacity ?? 0.92,
        stream: s, channel: c, click: opts.click(s), hover: opts.hover || "stream"
      });
    });
  }

  function layoutLanding(m, L) {
    const n = m.channels.length, gap = 12;
    const bandH = (plotBot - plotTop - gap * (n - 1)) / n;
    const stacks = m.channels.map((c) => streamsFor(m, c, false));
    const k = d3.min(stacks, (st) => (bandH * 0.74) / st.max);
    const obstacles = [];
    m.channels.forEach((c, i) => {
      const top = plotTop + i * (bandH + gap), cy = top + bandH / 2 + 7;
      const st = stacks[i];
      c._band = { top, bot: top + bandH, cy, k, st };
      L.bands.push({ y: top, h: bandH, cls: "band-hit", click: () => go(R.channel(c.type.id)), tip: { t1: c.type.plural, t2: c.type.definition, t3: "Click to open this channel" } });
      pushStack(L, m, c, st, cy, k, { click: () => () => go(R.channel(c.type.id)), hover: "landing" });
      if (!st.streams.length) {
        L.labels.push({ cls: "empty-lab", x: plotL() + 4, y: cy + 4, text: `No ${c.type.plural.toLowerCase()} in ${m.r0}–${m.r1} match these filters` });
      }
      channelTitle(L, c, plotL() + 2, top + 12, `${plural(c.nodes.length, "stream")} · ${plural(c.paperCount, "paper")}`, () => go(R.channel(c.type.id)));
      obstacles.push({ x0: plotL(), x1: plotL() + 360, y0: top, y1: top + 18 });
    });
    // Landmarks: biggest stream per channel, plus the two most clearly rising concepts.
    const marks = [
      ...m.biggest.map((b) => ({ node: b.node, kind: "Biggest", c: b.channel })),
      ...m.rising.map((x) => ({ node: x.node, kind: "Rising", c: m.channels.find((c) => c.type.id === x.node.type), share: x.share }))
    ];
    marks.forEach((mk) => placePill(L, m, mk, obstacles));
  }

  function placePill(L, m, mk, obstacles) {
    const band = mk.c._band;
    const st = band.st;
    const s = st.streams.find((x) => x.node && x.node.id === mk.node.id) || st.streams.find((x) => x.other);
    if (!s) return;
    const pts = basisPts(s.layer, band.cy, band.k);
    let ai;
    if (mk.kind === "Rising") {
      // anchor where the stream is widest in the recent part of the range
      const from = Math.max(0, m.recentFrom - m.r0);
      ai = d3.range(from, pts.length).reduce((b, i) => (pts[i].bot - pts[i].top > pts[b].bot - pts[b].top ? i : b), from);
    } else ai = d3.range(pts.length).reduce((b, i) => (pts[i].bot - pts[i].top > pts[b].bot - pts[b].top ? i : b), 0);
    const ax = pts[ai].x, ay = (pts[ai].top + pts[ai].bot) / 2;
    const name = mk.node.label;
    const kindTxt = mk.kind === "Rising" ? `RISING · ${fmtPct(mk.share)} since ${m.recentFrom}` : `BIGGEST · ${m.S(mk.node).total}`;
    const w = textW(name, 11, 500) + textW(kindTxt, 10, 400, true) + 30, h = 21;
    const env = basisPts(m.years.map((_, i) => [-st.env[i] / 2, st.env[i] / 2]), band.cy, band.k);
    const envTopOver = (x0, x1) => d3.min(env.filter((p) => p.x >= x0 - 20 && p.x <= x1 + 20), (p) => p.top) ?? band.cy;
    const envBotOver = (x0, x1) => d3.max(env.filter((p) => p.x >= x0 - 20 && p.x <= x1 + 20), (p) => p.bot) ?? band.cy;
    const cands = [];
    for (const dx of [0, -w * 0.35, w * 0.35, -w * 0.7, w * 0.7]) {
      let x0 = clamp(ax - w / 2 + dx, plotL() + 2, plotR() - w - 2);
      cands.push({ x0, y0: envTopOver(x0, x0 + w) - h - 6, leader: true });
      cands.push({ x0, y0: envBotOver(x0, x0 + w) + 6, leader: true });
    }
    let x0c = clamp(ax - w / 2, plotL() + 2, plotR() - w - 2);
    cands.push({ x0: x0c, y0: ay - h / 2, leader: false });
    const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    let pick = null;
    for (const c of cands) {
      const rect = { x0: c.x0 - 3, x1: c.x0 + w + 3, y0: c.y0 - 2, y1: c.y0 + h + 2 };
      if (rect.y0 < band.top + 1 || rect.y1 > band.bot + 4) continue;
      if (obstacles.some((o) => hit(o, rect))) continue;
      pick = c; obstacles.push(rect); break;
    }
    if (!pick) {
      pick = cands[cands.length - 1];
      const rect = { x0: pick.x0, x1: pick.x0 + w, y0: pick.y0, y1: pick.y0 + h };
      if (obstacles.some((o) => hit(o, rect))) return;
      obstacles.push(rect);
    }
    L.pills.push({
      x: pick.x0, y: pick.y0, w, h, name, kindTxt, color: mk.c.type.color,
      anchor: { x: ax, y: ay }, leader: pick.leader,
      click: () => go(R.concept(mk.node.id)),
      tip: { t1: name, t2: mk.kind === "Rising" ? `${fmtPct(mk.share)} of its papers are from ${m.recentFrom}–${m.r1} (all papers: ${fmtPct(m.corpusShare)})` : `The biggest ${mk.c.type.label.toLowerCase()} stream: ${plural(m.S(mk.node).total, "paper")} in ${m.r0}–${m.r1}`, t3: "Click to follow this stream" }
    });
  }

  function layoutChannel(m, L) {
    const r = state.route;
    const RH = 42, gap = 10;
    const others = m.channels.filter((c) => c.type.id !== r.channel);
    const exp = m.channels.find((c) => c.type.id === r.channel);
    const expH = plotBot - plotTop - others.length * (RH + gap);
    let y = plotTop;
    m.channels.forEach((c) => {
      if (c === exp) {
        const top = y, h = expH, cy = top + h / 2 + 8;
        const st = streamsFor(m, c, r.all);
        const k = ((h - 26) * 0.94) / st.max;
        L.bands.push({ y: top, h, cls: "band-sel" });
        pushStack(L, m, c, st, cy, k, {
          click: (s) => () => (s.other ? go(R.channel(c.type.id, true)) : go(R.concept(s.node.id)))
        });
        // labels inside streams
        const labeled = new Set();
        st.streams.forEach((s) => {
          const text = s.other ? `${s.count} smaller streams · click to unfold` : s.node.label;
          const thick = d3.max(s.layer, (d) => (d[1] - d[0]) * k);
          const big = thick > 34 && !s.other;
          let pos = fitLabel(s.layer, cy, k, text, big ? 12.5 : 11, big ? 600 : 500), small = false;
          if (!pos && !big) { pos = fitLabel(s.layer, cy, k, text, 9.5, 500); small = true; }
          if (pos) { labeled.add(s.key); L.labels.push({ cls: `slab ${big ? "big" : ""} ${small ? "tiny" : ""} ${s.other ? "light halo" : ""}`, x: pos.x, y: pos.y + (small ? 3.4 : 4), text, anchor: "middle", hl: s.key }); }
        });
        // Streams too thin for an inside label get one in the right-hand gutter, at the height
        // where they leave the plot, nudged apart so labels never overlap.
        const gx = plotR() + 14, gw = W - gx - 6;
        const placedY = [];
        st.streams
          .filter((s) => !labeled.has(s.key))
          .map((s) => { const pts = basisPts(s.layer, cy, k); const pe = pts[pts.length - 1]; return { s, y: (pe.top + pe.bot) / 2 }; })
          .sort((a, b) => b.s.total - a.s.total)
          .forEach(({ s, y: ty }) => {
            let yy = null;
            for (let d = 0; d <= 90 && yy === null; d++) {
              for (const cand of d ? [ty - d, ty + d] : [ty]) {
                if (cand < top + 30 || cand > top + h - 8) continue;
                if (placedY.every((py) => Math.abs(py - cand) >= 13)) { yy = cand; break; }
              }
            }
            if (yy === null) return;
            placedY.push(yy);
            let text = s.other ? `${s.count} smaller streams` : s.node.label;
            while (text.length > 4 && textW(text, 10.5) > gw) text = text.slice(0, -2).trimEnd() + "…";
            if (text.endsWith("……")) text = text.replace(/…+$/, "…");
            L.labels.push({
              cls: "glab", x: gx, y: yy + 3.5, text, fill: s.other ? "var(--muted)" : d3.color(s.type.color).brighter(0.2), hl: s.key,
              leader: `M${plotR() + 1},${ty}C${plotR() + 7},${ty} ${plotR() + 6},${yy} ${gx - 3},${yy}`,
              click: s.other ? () => go(R.channel(c.type.id, true)) : () => go(R.concept(s.node.id)),
              tip: s.other ? { t1: `${s.count} smaller streams`, t3: "Click to unfold them" } : { t1: s.node.label, t2: `${plural(s.total, "paper")} in ${m.r0}–${m.r1}`, t3: "Click to follow this stream" }
            });
          });
        const sub = r.all
          ? `all ${plural(st.streams.length, "stream")} · ${plural(c.paperCount, "paper")}`
          : `${plural(c.nodes.length, "stream")} · ${plural(c.paperCount, "paper")}${c.nodes.length > TOP_N ? ` · top ${TOP_N} shown` : ""}`;
        channelTitle(L, c, plotL() + 2, top + 13, sub, null);
        const btnTxt = r.all ? "Merge the small streams" : c.nodes.length > TOP_N ? `Unfold all ${c.nodes.length} streams` : null;
        if (btnTxt) {
          const w = textW(btnTxt, 11) + 22;
          L.pills.push({ x: plotR() - w, y: top + 1, w, h: 21, name: btnTxt, kindTxt: "", color: c.type.color, button: true, click: () => go(R.channel(c.type.id, !r.all)) });
        }
        if (!st.streams.length) {
          L.empty = { title: `No ${c.type.plural.toLowerCase()} in ${m.r0}–${m.r1} match these filters`, text: m.f.minPapers > 1 ? `Every stream has fewer than ${m.f.minPapers} papers in this range.` : "Try a wider year range.", action: "filters" };
        }
        y += h + gap;
      } else {
        const top = y, cy = top + RH / 2 + 5;
        const st = streamsFor(m, c, false);
        const k = (RH - 16) / st.max;
        L.bands.push({ y: top, h: RH, cls: "band-hit", click: () => go(R.channel(c.type.id)), tip: { t1: c.type.plural, t2: c.type.definition, t3: "Click to open this channel" } });
        pushStack(L, m, c, st, cy, k, { opacity: 0.55, click: () => () => go(R.channel(c.type.id)), hover: "ribbon" });
        channelTitle(L, c, plotL() + 2, top + 10, `${plural(c.nodes.length, "stream")} · shrunk to fit`, () => go(R.channel(c.type.id)));
        y += RH + gap;
      }
    });
  }

  function layoutConcept(m, L) {
    const r = state.route;
    const focus = atlas.byId.get(r.concept);
    const fs = m.S(focus);
    const nb = atlas.neighbors(focus.id, m.f);
    const sections = m.channels.map((c) => ({ c, kind: c.type.id === focus.type ? "river" : "group", all: nb.filter((x) => x.node.type === c.type.id), lanes: [] }));
    const plotH = plotBot - plotTop;
    let riverH = clamp(plotH * 0.3, 110, 230);
    const headerH = 26, laneH = 30, gap = 10, emptyH = 20;
    const groups = sections.filter((s) => s.kind === "group");
    let fixed = riverH + groups.length * headerH + gap * (sections.length - 1);
    groups.forEach((s) => { if (!s.all.length) fixed += emptyH; });
    let budget = Math.max(0, Math.floor((plotH - fixed) / laneH));
    const cap = (s) => (s.kind === "river" ? 3 : 6);
    let progress = true;
    while (budget > 0 && progress) {
      progress = false;
      for (const s of sections) {
        if (budget <= 0) break;
        if (s.lanes.length < Math.min(cap(s), s.all.length)) { s.lanes.push(s.all[s.lanes.length]); budget--; progress = true; }
      }
    }
    if (r.other) {
      const s = sections.find((x) => x.all.some((y) => y.node.id === r.other));
      if (s && !s.lanes.some((y) => y.node.id === r.other)) {
        const item = s.all.find((y) => y.node.id === r.other);
        if (s.lanes.length) s.lanes[s.lanes.length - 1] = item;
        else if (budget > 0) { s.lanes.push(item); budget--; }
        else {
          const donor = sections.slice().sort((a, b) => b.lanes.length - a.lanes.length)[0];
          if (donor && donor.lanes.length) { donor.lanes.pop(); s.lanes.push(item); }
        }
      }
    }
    const used = fixed + d3.sum(sections, (s) => s.lanes.length) * laneH;
    const extra = Math.max(0, plotH - used);
    const grow = Math.min(extra, Math.max(0, plotH * 0.5 - riverH));
    riverH += grow;
    const gapX = sections.length > 1 ? gap + (extra - grow) / (sections.length - 1) * 0.5 : gap;

    let y = plotTop;
    let river = null;
    const lanesOut = [];
    sections.forEach((s) => {
      const c = s.c;
      if (s.kind === "river") {
        const top = y;
        const cy = top + 34 + (riverH - 34) / 2;
        const k = fs.total ? ((riverH - 40) * 0.95) / (d3.max(fs.smooth) || 1) : 1;
        const layer = fs.smooth.map((v) => [-v / 2, v / 2]);
        river = { cy, top, bot: top + riverH, k };
        L.bands.push({ y: top, h: riverH, cls: "band-sel" });
        L.streams.push({ key: `${c.type.id}:${focus.id}`, d: areaGen(cy, k)(layer), fill: c.type.color, opacity: 0.95, stream: { node: focus, type: c.type, ...fs }, channel: c, click: null, hover: "river", flat: true });
        L.labels.push({ cls: "river-title halo", x: plotL() + 2, y: top + 15, text: focus.label, hl: null });
        const peakI = fs.raw.indexOf(d3.max(fs.raw));
        const sub = fs.total
          ? `${c.type.label.toUpperCase()} · ${plural(fs.total, "paper")} in ${m.r0}–${m.r1} · first studied ${focus.firstYear} · peak ${m.years[peakI]} (${fs.raw[peakI]})`
          : `${c.type.label.toUpperCase()} · no papers in ${m.r0}–${m.r1}`;
        L.labels.push({ cls: "river-sub halo", x: plotL() + 2, y: top + 30, text: sub });
        if (fs.total && focus.firstYear >= m.r0 && focus.firstYear <= m.r1) {
          const pts = basisPts(layer, cy, k);
          const fi = focus.firstYear - m.r0;
          const room = X(focus.firstYear) - plotL() > 90;
          L.labels.push({ cls: "river-sub halo", x: room ? X(focus.firstYear) - 6 : X(focus.firstYear) + 4, y: room ? cy + 4 : pts[fi].top - 8, text: room ? `rises ${focus.firstYear} ›` : `↓ rises ${focus.firstYear}`, anchor: room ? "end" : "start" });
        }
        if (!fs.total) L.labels.push({ cls: "empty-lab", x: (plotL() + plotR()) / 2, y: cy + 4, text: `This stream has no papers in ${m.r0}–${m.r1}. Widen the year range below.`, anchor: "middle" });
        y += riverH;
        if (s.lanes.length) y += 4;
      } else {
        const top = y;
        const st = streamsFor(m, c, false);
        L.bands.push({ y: top, h: headerH - 2, cls: "band-hit", click: () => go(R.channel(c.type.id)), tip: { t1: c.type.plural, t2: `${plural(s.all.length, "connected " + c.type.label.toLowerCase())} in ${m.r0}–${m.r1}`, t3: "Click to open this channel" } });
        pushStack(L, m, c, st, top + 19, 7 / st.max, { opacity: 0.32, click: () => () => go(R.channel(c.type.id)), hover: "ribbon" });
        const sub = s.all.length ? `${s.lanes.length < s.all.length ? `top ${s.lanes.length} of ` : ""}${plural(s.all.length, "connected stream")}${s.lanes.length < s.all.length ? " (all in the panel)" : ""}` : "";
        channelTitle(L, c, plotL() + 2, top + 11, sub, () => go(R.channel(c.type.id)));
        y += headerH;
        if (!s.all.length) {
          L.labels.push({ cls: "empty-lab", x: plotL() + 4, y: y + 10, text: `No shared papers with any ${c.type.label.toLowerCase()}${atlas.rangeActive(m.f) ? ` in ${m.r0}–${m.r1}` : ""}${m.f.minPapers > 1 ? ` (min ${m.f.minPapers} papers)` : ""}` });
          y += emptyH;
        }
      }
      s.lanes.forEach((item) => {
        lanesOut.push({ item, top: y, c });
        y += laneH;
      });
      y += gapX;
    });
    // lanes: label, thin own stream, confluence dots
    const yearW = Math.abs(X(m.r0 + 1) - X(m.r0));
    const cols = Math.max(1, Math.floor((yearW - 1) / 6.2));
    lanesOut.forEach(({ item, top, c }) => {
      const n = item.node, ns = m.S(n);
      const cy = top + 20;
      const shared = atlas.papersIn(item.link.papers, m.f);
      const byYear = d3.group(shared, (p) => p.year);
      const dots = [];
      byYear.forEach((ps, yr) => {
        ps.sort((a, b) => String(a.title).localeCompare(String(b.title)));
        const perRow = Math.min(cols, ps.length);
        const rowsOff = [0, 5.4, -5.4, 10.8];
        ps.forEach((p, j) => {
          const row = Math.floor(j / cols), col = j % cols;
          const inRow = Math.min(cols, ps.length - row * cols);
          dots.push({ p, x: X(yr) + (col - (inRow - 1) / 2) * 6.2, y: cy + (rowsOff[row] ?? (row * 5.4)) });
        });
        void perRow;
      });
      const thinK = 7 / (d3.max(ns.smooth) || 1);
      L.lanes.push({
        id: n.id, node: n, c, top, cy, h: laneH, shared: item.shared, dots,
        thin: areaGen(cy, thinK)(ns.smooth.map((v) => [-v / 2, v / 2])),
        sel: r.other === n.id, river
      });
    });
    L.river = river;
    L.focus = focus;
  }

  // ---------- Drawing ----------
  let hoverKey = null;
  function draw(L, animate) {
    const t = svg.transition("main").duration(animate ? DUR : 0).ease(d3.easeCubicInOut);
    const fadeDelay = animate ? DUR * 0.55 : 0;
    const fadeDur = animate && !reduceMotion ? 300 : 0;

    // grid: decades (eras) + axis
    gGrid.selectAll("*").remove();
    const [d0, d1] = X.domain();
    const decades = d3.range(Math.ceil(d0 / 10) * 10, d1 + 1, 10);
    decades.forEach((dc) => {
      gGrid.append("line").attr("class", "era-line").attr("x1", X(dc - 0.5)).attr("x2", X(dc - 0.5)).attr("y1", plotTop - 8).attr("y2", plotBot);
    });
    const eraStarts = [Math.ceil(d0), ...decades.filter((dc) => dc > Math.ceil(d0) + 2)];
    eraStarts.forEach((ys, i) => {
      const ye = i + 1 < eraStarts.length ? eraStarts[i + 1] : Math.floor(d1);
      const mid = (X(ys - 0.5) + X(ye - 0.5)) / 2;
      const lab = `${Math.floor(ys / 10) * 10}s`;
      if (X(ye - 0.5) - X(ys - 0.5) > 40) gGrid.append("text").attr("class", "era-lab").attr("x", clamp(mid, plotL() + 14, plotR() - 14)).attr("y", 13).attr("text-anchor", "middle").text(lab);
    });
    const span = d1 - d0;
    const step = [1, 2, 5, 10].find((s) => (span / s) * 64 < W) || 10;
    const ticks = d3.range(Math.ceil(d0 / step) * step, d1 + 0.01, step).filter((y) => y >= Y0 && y <= Y1);
    const ax = gGrid.append("g").attr("class", "axis").attr("transform", `translate(0,${plotBot + 4})`);
    ax.append("line").attr("x1", plotL()).attr("x2", plotR()).attr("y1", 0).attr("y2", 0);
    ticks.forEach((y) => {
      ax.append("line").attr("x1", X(y)).attr("x2", X(y)).attr("y1", 0).attr("y2", 4);
      ax.append("text").attr("x", X(y)).attr("y", 16).attr("text-anchor", "middle").text(y);
    });
    years.forEach((y) => {
      if (!yearsWithPapers.has(y)) ax.append("text").attr("class", "gap-mark").attr("x", X(y)).attr("y", -4).attr("text-anchor", "middle").text("·").append("title").text(`No papers in the data for ${y}`);
    });

    // bands
    gBands.selectAll("*").remove();
    L.bands.forEach((b) => {
      const rect = gBands.append("rect").attr("class", b.cls).attr("x", plotL() - 8).attr("width", plotR() - plotL() + 16).attr("y", b.y).attr("height", Math.max(0, b.h)).attr("rx", 10);
      if (b.click) rect.on("click", b.click);
      if (b.tip) rect.on("mousemove", (e) => showTip(e, b.tip)).on("mouseleave", hideTip);
    });

    // streams (keyed so shapes morph between levels)
    gStreams.selectAll("path.stream")
      .data(L.streams, (d) => d.key)
      .join(
        (en) => en.append("path").attr("class", "stream").attr("d", (d) => d.d).attr("opacity", 0),
        (up) => up,
        (ex) => ex.classed("exiting", true).style("pointer-events", "none").transition(t).attr("opacity", 0).remove()
      )
      .classed("exiting", false).style("pointer-events", null)
      .attr("fill", (d) => d.fill)
      .classed("flat", (d) => !d.click)
      .classed("hot", false)
      .on("mouseenter", (e, d) => streamHover(d, true))
      .on("mousemove", (e, d) => showTip(e, streamTip(d, e)))
      .on("mouseleave", (e, d) => { streamHover(d, false); hideTip(); })
      .on("click", (e, d) => { if (d.click) { hideTip(); d.click(); } })
      .transition(t).attr("d", (d) => d.d).attr("opacity", (d) => d.opacity);
    gStreams.selectAll("path.stream:not(.exiting)").sort((a, b) => L.streams.indexOf(a) - L.streams.indexOf(b));

    // lanes
    gLanes.selectAll("*").remove();
    gConf.selectAll("*").remove();
    const laneSel = gLanes.selectAll("g.lane").data(L.lanes, (d) => d.id).join("g")
      .attr("class", (d) => `lane ${d.sel ? "sel" : ""}`)
      .attr("data-id", (d) => d.id)
      .attr("opacity", animate ? 0 : 1);
    laneSel.append("rect").attr("class", "lane-hit").attr("x", plotL() - 8).attr("width", plotR() - plotL() + 16).attr("y", (d) => d.top).attr("height", (d) => d.h - 2).attr("rx", 8);
    laneSel.append("line").attr("class", "ln").attr("x1", plotL()).attr("x2", plotR()).attr("y1", (d) => d.cy).attr("y2", (d) => d.cy);
    laneSel.append("path").attr("d", (d) => d.thin).attr("fill", (d) => d.c.type.color).attr("fill-opacity", 0.22);
    laneSel.append("text").attr("class", "lane-lab halo").attr("x", plotL() + 2).attr("y", (d) => d.top + 10).attr("fill", (d) => d3.color(d.c.type.color).brighter(0.3))
      .text((d) => d.node.label)
      .append("tspan").attr("class", "lane-n").text((d) => `  ${d.shared} shared`);
    laneSel
      .on("mouseenter", (e, d) => laneHover(d, true))
      .on("mouseleave", (e, d) => { laneHover(d, false); hideTip(); })
      .on("mousemove", (e, d) => { if (!e.target.classList.contains("cdot")) showTip(e, { t1: `${L.focus.label} + ${d.node.label}`, t2: `${plural(d.shared, "shared paper")} in ${state.filter.range[0]}–${state.filter.range[1]}`, t3: "Click to see why they are connected" }); })
      .on("click", (e, d) => { if (!e.target.classList.contains("cdot")) { hideTip(); go(R.link(L.focus.id, d.id)); } });
    const selPaper = state.route.paper;
    laneSel.selectAll("circle.cdot").data((d) => d.dots.map((x) => ({ ...x, lane: d }))).join("circle")
      .attr("class", (d) => `cdot ${d.p.paper_id === selPaper ? "sel" : ""}`)
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y)
      .attr("r", (d) => (d.p.paper_id === selPaper ? 4.2 : d.lane.sel ? 3.2 : 2.7))
      .attr("fill", (d) => d3.color(d.lane.c.type.color).brighter(0.4))
      .on("mousemove", (e, d) => showTip(e, { t1: paperTitle(d.p), t2: `${d.p.year} · ${d.p.authors || "authors unknown"}`, t3: "Click to open this paper" }))
      .on("mouseleave", hideTip)
      .on("click", (e, d) => { e.stopPropagation(); hideTip(); go({ concept: L.focus.id, other: d.lane.id, paper: d.p.paper_id }); });
    if (animate) laneSel.transition().delay((d, i) => fadeDelay + i * 18).duration(fadeDur).attr("opacity", 1);
    const selLane = L.lanes.find((l) => l.sel);
    if (selLane) drawConfluence(selLane, true);

    // labels
    gLabels.selectAll("*").remove();
    L.labels.forEach((lb) => {
      if (lb.leader) {
        const ld = gLabels.append("path").attr("class", "leader").attr("d", lb.leader).attr("stroke", lb.fill || "#9aa2b2").attr("stroke-opacity", 0.45);
        if (animate) ld.attr("opacity", 0).transition().delay(fadeDelay).duration(fadeDur).attr("opacity", 1);
      }
      const el = gLabels.append("text").attr("class", lb.cls).attr("x", lb.x).attr("y", lb.y).attr("text-anchor", lb.anchor || "start").text(lb.text);
      if (lb.fill) el.attr("fill", lb.fill);
      if (lb.click) el.style("cursor", "pointer").on("click", lb.click);
      else el.style("pointer-events", "none");
      if (lb.tip) el.on("mousemove", (e) => showTip(e, lb.tip)).on("mouseleave", () => { hideTip(); if (lb.hl && lb.click) hlCanvas(null); });
      if (lb.hl && lb.click) el.on("mouseenter", () => hlCanvas(lb.hl));
      if (animate) el.attr("opacity", 0).transition().delay(fadeDelay).duration(fadeDur).attr("opacity", 1);
    });

    // pills (landmarks + buttons)
    gPills.selectAll("*").remove();
    L.pills.forEach((p) => {
      const g = gPills.append("g").attr("class", "pill");
      if (p.leader) {
        const ey = p.y > p.anchor.y ? p.y : p.y + p.h;
        const ex = clamp(p.anchor.x, p.x + 10, p.x + p.w - 10);
        g.append("path").attr("class", "leader").attr("stroke", p.color).attr("stroke-opacity", 0.7).attr("d", `M${ex},${ey}L${p.anchor.x},${p.anchor.y}`);
      }
      if (p.anchor) g.append("circle").attr("class", "anchor").attr("cx", p.anchor.x).attr("cy", p.anchor.y).attr("r", 3.2).attr("fill", "#fff").attr("stroke", p.color).attr("stroke-width", 1.5);
      g.append("rect").attr("x", p.x).attr("y", p.y).attr("width", p.w).attr("height", p.h).attr("rx", p.h / 2).attr("stroke", p.color).attr("stroke-opacity", p.button ? 0.45 : 0.8);
      const tx = g.append("text").attr("x", p.x + 11).attr("y", p.y + p.h / 2 + 4);
      if (p.kindTxt) tx.append("tspan").attr("class", "kind").text(p.kindTxt + "  ");
      tx.append("tspan").text(p.name);
      g.on("click", (e) => { e.stopPropagation(); hideTip(); p.click(); });
      if (p.tip) g.on("mousemove", (e) => showTip(e, p.tip)).on("mouseleave", hideTip);
      if (animate) g.attr("opacity", 0).transition().delay(fadeDelay + 120).duration(fadeDur).attr("opacity", 1);
    });

    // paper marker
    gHover.selectAll(".paper-mark").remove();
    if (L.marker) {
      const mx = X(L.marker.year);
      gHover.append("line").attr("class", "paper-rule paper-mark").attr("x1", mx).attr("x2", mx).attr("y1", plotTop - 6).attr("y2", plotBot);
      gHover.append("text").attr("class", "paper-rule-lab halo paper-mark").attr("x", clamp(mx, plotL() + 60, plotR() - 60)).attr("y", plotTop - 2).attr("text-anchor", "middle").text(L.marker.label);
    }

    // empty state
    const em = $("#empty");
    if (L.empty) {
      em.hidden = false;
      em.innerHTML = `<b>${esc(L.empty.title)}</b>${esc(L.empty.text)}<br/><button class="text-btn" id="emptyFix">${L.empty.action === "types" ? "Show all channels" : "Clear filters"}</button>`;
      $("#emptyFix").onclick = () => setFilter((f) => { const d = atlas.defaultFilter(); f.types = d.types; if (L.empty.action !== "types") { f.range = d.range; f.minPapers = 1; } });
    } else em.hidden = true;
  }

  function drawConfluence(lane, persistent) {
    if (!lane.river || !lane.dots.length) return;
    const g = gConf.append("g").attr("class", persistent ? "persist" : "transient");
    const ry = lane.river.cy;
    lane.dots.forEach((d) => {
      g.append("line").attr("class", "conf-line").attr("x1", d.x).attr("x2", d.x).attr("y1", d.y).attr("y2", ry)
        .attr("stroke", d3.color(lane.c.type.color).brighter(0.5)).attr("stroke-opacity", persistent ? 0.3 : 0.6);
    });
  }
  function laneHover(d, on) {
    gConf.selectAll(".transient").remove();
    if (on && !d.sel) drawConfluence(d, false);
    hlPanel(on ? `lane:${d.id}` : null);
  }
  function streamHover(d, on) {
    hoverKey = on ? d.key : null;
    gStreams.selectAll("path.stream").classed("hot", (x) => on && x.key === d.key);
    hlPanel(on && d.stream.node ? `${d.key}` : null);
  }
  function hlPanel(key) {
    document.querySelectorAll("#panel [data-hl].hot").forEach((el) => el.classList.remove("hot"));
    if (key) document.querySelectorAll(`#panel [data-hl="${CSS.escape(key)}"]`).forEach((el) => el.classList.add("hot"));
  }
  // highlight from panel rows → canvas
  function hlCanvas(key) {
    const plot = svg.node();
    gStreams.selectAll("path.stream").classed("hot", (x) => !!key && x.key === key);
    gLanes.selectAll("g.lane").classed("hot", (x) => !!key && `lane:${x.id}` === key);
    const hasStream = !!key && !gStreams.selectAll("path.stream").filter((x) => x.key === key).empty();
    const hasLane = !!key && !gLanes.selectAll("g.lane").filter((x) => `lane:${x.id}` === key).empty();
    plot.classList.toggle("dim", hasStream || hasLane);
    gConf.selectAll(".transient").remove();
    if (hasLane) {
      const d = gLanes.selectAll("g.lane").filter((x) => `lane:${x.id}` === key).datum();
      if (!d.sel) drawConfluence(d, false);
    }
  }

  function streamTip(d, e) {
    const s = d.stream;
    const [mx] = d3.pointer(e, svg.node());
    const yr = clamp(Math.round(X.invert(mx)), state.filter.range[0], state.filter.range[1]);
    const i = yr - state.filter.range[0];
    const r = state.filter.range;
    const yearNote = yearsWithPapers.has(yr) ? `${yr}: ${plural(s.raw[i], "paper")}` : `${yr}: no papers in the data for this year`;
    if (s.other) {
      return { t1: `${s.count} smaller ${s.type.plural.toLowerCase()}`, t2: `${yearNote} · ${plural(s.total, "paper mention")} in ${r[0]}–${r[1]}`, t3: d.hover === "ribbon" || d.hover === "landing" ? `Click to open ${s.type.plural}` : "Click to unfold them into separate streams" };
    }
    const n = s.node;
    const t3 = d.hover === "landing" || d.hover === "ribbon" ? `Click to open the ${s.type.plural} channel` : d.hover === "river" ? `First studied ${n.firstYear}` : "Click to follow this stream";
    return { t1: n.label, t2: `${yearNote} · ${plural(s.total, "paper")} in ${r[0]}–${r[1]}`, t3 };
  }
  function showTip(e, c) {
    if (!c) return;
    tip.hidden = false;
    tip.innerHTML = `<div class="t1">${esc(c.t1)}</div>${c.t2 ? `<div class="t2">${esc(c.t2)}</div>` : ""}${c.t3 ? `<div class="t3">${esc(c.t3)}</div>` : ""}`;
    const wrap = $("#plotWrap").getBoundingClientRect();
    let x = e.clientX - wrap.left + 14, y = e.clientY - wrap.top + 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > wrap.width - 6) x = e.clientX - wrap.left - tw - 14;
    if (y + th > wrap.height - 6) y = e.clientY - wrap.top - th - 12;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  }
  function hideTip() { tip.hidden = true; }

  // crosshair
  svg.on("mousemove.x", (e) => {
    const [mx, my] = d3.pointer(e);
    if (mx < plotL() || mx > plotR() || my < plotTop - 10 || my > plotBot + 4) { xhair.style("display", "none"); xhairLab.style("display", "none"); return; }
    const yr = clamp(Math.round(X.invert(mx)), state.filter.range[0], state.filter.range[1]);
    xhair.style("display", null).attr("x1", X(yr)).attr("x2", X(yr)).attr("y1", plotTop - 6).attr("y2", plotBot);
    xhairLab.style("display", null).attr("x", clamp(X(yr), plotL() + 16, plotR() - 16)).attr("y", plotBot + 20).text(yr);
  }).on("mouseleave.x", () => { xhair.style("display", "none"); xhairLab.style("display", "none"); hideTip(); });

  // ---------- Overview + year brush ----------
  const ov = d3.select("#overview");
  const ovBars = ov.append("g");
  const ovAxis = ov.append("g").attr("class", "ov-axis");
  const ovHint = ov.append("text").attr("class", "ov-hint");
  const brushG = ov.append("g").attr("class", "brush");
  let X2 = d3.scaleLinear();
  let brushing = false;
  const yearTotals = d3.range(Y0, Y1 + 1).map((y) => ({ y, n: atlas.papers.filter((p) => p.year === y).length }));
  const brush = d3.brushX()
    .on("brush", (e) => {
      if (!e.sourceEvent || !e.selection) return;
      brushing = true;
      const rg = snap(e.selection);
      if (rg[0] !== state.filter.range[0] || rg[1] !== state.filter.range[1]) {
        state.filter.range = rg;
        scheduleLive();
      }
    })
    .on("end", (e) => {
      if (!e.sourceEvent) return;
      brushing = false;
      const rg = e.selection ? snap(e.selection) : [Y0, Y1];
      setFilter((f) => { f.range = rg; });
    });
  function snap(sel) {
    let a = Math.round(X2.invert(sel[0]) + 0.5), b = Math.round(X2.invert(sel[1]) - 0.5);
    a = clamp(a, Y0, Y1); b = clamp(b, Y0, Y1);
    if (b - a < 2) { if (a + 2 <= Y1) b = a + 2; else a = b - 2; }
    return [a, b];
  }
  let liveQueued = false;
  function scheduleLive() {
    if (liveQueued) return;
    liveQueued = true;
    requestAnimationFrame(() => { liveQueued = false; render(false, true); });
  }
  function renderOverview() {
    const node = ov.node();
    const w = node.clientWidth, h = node.clientHeight;
    X2 = d3.scaleLinear().domain([Y0 - 0.5, Y1 + 0.5]).range([M.l, w - 22]);
    const hy = d3.scaleLinear().domain([0, d3.max(yearTotals, (d) => d.n)]).range([0, h - 24]);
    const [r0, r1] = state.filter.range;
    const bw = Math.max(1, X2(1) - X2(0) - 2);
    ovBars.selectAll("rect").data(yearTotals).join("rect")
      .attr("class", (d) => `ov-bar ${d.y >= r0 && d.y <= r1 ? "in" : ""}`)
      .attr("x", (d) => X2(d.y) - bw / 2).attr("width", bw)
      .attr("y", (d) => h - 16 - hy(d.n)).attr("height", (d) => hy(d.n)).attr("rx", 1);
    ovAxis.attr("transform", `translate(0,${h - 4})`);
    const tks = d3.range(1990, Y1 + 1, 5);
    ovAxis.selectAll("text").data(tks).join("text").attr("x", (d) => X2(d)).attr("text-anchor", "middle").text((d) => d);
    ovHint.attr("x", M.l).attr("y", 10).text(atlas.rangeActive(state.filter) ? "" : "drag across the years to zoom the river ↔");
    brush.extent([[M.l, 2], [w - 22, h - 15]]);
    brushG.call(brush);
    if (!brushing) {
      if (atlas.rangeActive(state.filter)) brushG.call(brush.move, [X2(r0 - 0.5), X2(r1 + 0.5)]);
      else brushG.call(brush.move, null);
    }
  }

  // ---------- Filter row ----------
  function renderFilters(m) {
    const f = state.filter;
    const counts = new Map(m.channels.map((c) => [c.type.id, c.nodes.length]));
    const el = $("#filters");
    const chips = TYPES.map((t) => `<button class="chip ${f.types.has(t.id) ? "" : "off"}" data-type="${t.id}" aria-pressed="${f.types.has(t.id)}" title="${f.types.has(t.id) ? "Hide" : "Show"} the ${esc(t.plural)} channel"><span class="sw" style="background:${t.color}"></span>${esc(t.plural)}${f.types.has(t.id) ? ` <span class="cnt" style="color:var(--faint)">${counts.get(t.id) ?? 0}</span>` : ""}</button>`).join("");
    const yr = `<span class="yr-readout">${f.range[0]}–${f.range[1]}${atlas.rangeActive(f) ? `<button class="clear" id="clearYears">all years</button>` : ""}</span>`;
    if (!el.dataset.ready) {
      el.innerHTML = `<span class="lab first">Channels</span><span id="chips" style="display:flex;gap:6px"></span><span class="grow"></span>
        <label class="minp" title="Hide streams with fewer papers than this in the year range"><span class="lab">Min</span><input id="minp" type="range" min="1" max="40" step="1" /><output id="minpOut"></output></label>
        <span class="lab" style="margin-left:10px">Years</span><span id="yrBox"></span>`;
      el.dataset.ready = "1";
      $("#minp").addEventListener("input", (e) => { $("#minpOut").textContent = e.target.value; setFilter((ff) => { ff.minPapers = +e.target.value; }, true); });
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-type]");
        if (b) {
          const id = b.dataset.type;
          setFilter((ff) => { if (ff.types.has(id)) { if (ff.types.size > 1) ff.types.delete(id); else return; } else ff.types.add(id); });
        }
        if (e.target.id === "clearYears") setFilter((ff) => { ff.range = [Y0, Y1]; });
      });
    }
    $("#chips").innerHTML = chips;
    $("#yrBox").innerHTML = yr;
    if (document.activeElement !== $("#minp")) $("#minp").value = f.minPapers;
    $("#minpOut").textContent = f.minPapers;
  }

  function renderLegend() {
    const r = state.route;
    const span = `${state.filter.range[0]}–${state.filter.range[1]}`;
    let html;
    if (r.concept) {
      html = `<span class="k"><b>→</b> year, ${span}</span><span class="k"><span class="sw" style="background:linear-gradient(90deg,#ffffff22,#ffffffaa)"></span>top stream: its papers per year (3-yr avg)</span><span class="k"><b>lanes</b> connected concepts</span><span class="k"><span class="dt"></span>a shared paper, at the year it was published</span>`;
    } else {
      html = `<span class="k"><b>→</b> year, ${span}</span><span class="k"><span class="sw"></span><b>width</b> = papers per year (3-yr avg; a paper with two tasks counts in both)</span><span class="k"><b>channel</b> = concept type</span><span class="k"><span class="sw" style="background:repeating-linear-gradient(45deg,#9aa2b2 0 2px,transparent 2px 5px)"></span>smaller streams, merged</span>`;
    }
    $("#legend").innerHTML = html;
  }

  // ---------- Breadcrumb ----------
  function renderCrumbs() {
    const r = state.route;
    const items = [{ label: "Watershed", route: {} }];
    if (r.channel) items.push({ label: typeObj(r.channel).plural, route: { channel: r.channel }, color: typeColor(r.channel) });
    if (r.concept) items.push({ label: atlas.byId.get(r.concept).label, route: { concept: r.concept } });
    if (r.other) items.push({ label: `+ ${atlas.byId.get(r.other).label}`, route: { concept: r.concept, other: r.other } });
    if (r.paper != null) {
      const p = atlas.paperById.get(r.paper);
      if (p) items.push({ label: paperTitle(p), route: r });
    }
    $("#crumbs").innerHTML = items.map((it, i) => {
      const last = i === items.length - 1;
      return `${i ? '<span class="sep">›</span>' : ""}<button class="${last ? "cur" : ""}" ${last ? 'aria-current="page"' : `data-go="${esc(hashFor(it.route))}"`} title="${esc(it.label)}">${it.color ? `<span class="dot" style="background:${it.color}"></span>` : ""}${esc(it.label)}</button>`;
    }).join("");
    $("#back").disabled = !r.channel && r.paper == null;
  }

  // ---------- Panel ----------
  const rowConcept = (n, count, max, extra = "", hl = "") => `<button class="row" data-go="${esc(hashFor(R.concept(n.id)))}" ${hl ? `data-hl="${esc(hl)}"` : ""}>
      <span class="sw" style="background:${typeColor(n.type)}"></span>
      <span class="nm">${esc(n.label)}</span>${extra ? `<small class="ex">${extra}</small>` : "<i></i>"}
      <span class="ct" style="color:${typeColor(n.type)}"><span class="bar" style="width:${Math.max(3, Math.round((count / max) * 54))}px"></span><span style="color:var(--muted)">${count}</span></span></button>`;
  const paperRow = (p, route, extra = "") => `<button class="paper-row" data-go="${esc(hashFor(route))}"><span class="yr">${p.year}</span><span class="ttl">${esc(paperTitle(p))}<span class="au">${esc(p.authors || "")}</span>${extra}</span></button>`;
  function liftPhrase(ex) {
    const expct = ex.lift ? ex.n / ex.lift : 0;
    const e = expct < 1 ? expct.toFixed(1) : Math.round(expct);
    if (ex.lift >= 1.5) return `<b>${ex.lift.toFixed(1)}×</b> more often than chance. If papers picked these two topics independently, you would expect about ${e} shared ${expct === 1 ? "paper" : "papers"}; there are ${ex.n}.`;
    if (ex.lift >= 1.15) return `<b>A little more often</b> than chance (${ex.lift.toFixed(1)}×): about ${e} expected, ${ex.n} found.`;
    if (ex.lift >= 0.85) return `<b>About as often as chance</b> would predict (${e} expected, ${ex.n} found). Both are common, so they meet a lot anyway.`;
    return `<b>Less often than chance</b> (${ex.lift.toFixed(1)}×): about ${e} expected, only ${ex.n} found. They meet, but tend to be studied apart.`;
  }

  function renderPanel(m) {
    const r = state.route;
    const el = $("#panel");
    let html = "";
    if (r.paper != null) html = panelPaper(m, r);
    else if (r.other) html = panelLink(m, r);
    else if (r.concept) html = panelConcept(m, r);
    else if (r.channel) html = panelChannel(m, r);
    else html = panelHome(m);
    const key = JSON.stringify(r);
    const changed = el.dataset.key !== key;
    el.innerHTML = `<div class="${changed ? "swap" : ""}">${html}</div>`;
    el.dataset.key = key;
  }

  function panelHome(m) {
    const yrs = m.r1 - m.r0;
    const lm = [
      ...m.biggest.map((b) => rowConcept(b.node, m.S(b.node).total, m.S(b.node).total, "", `${b.node.type}:${b.node.id}`).replace('<span class="nm">', `<span class="nm"><span class="mark">biggest</span>`)),
      ...m.rising.map((x) => rowConcept(x.node, x.total, x.total, "", `${x.node.type}:${x.node.id}`).replace('<span class="nm">', `<span class="nm"><span class="mark" style="color:#c5e1a5">rising</span>`))
    ].join("");
    const chans = m.channels.map((c) => `<button class="row ch" data-go="${esc(hashFor(R.channel(c.type.id)))}"><span class="sw" style="background:${c.type.color}"></span><span class="nm">${esc(c.type.plural)}<span class="def">${esc(c.type.definition)}</span></span><span class="ct">${c.nodes.length}</span></button>`).join("");
    return `<p class="eyebrow">Design Engineering Atlas · ASME DTM</p>
      <h1>${yrs} years of design research, flowing left to right.</h1>
      <p class="lede">${plural(m.inRange.length, "empirical paper")} from ${m.r0} to ${m.r1}. Each concept is a stream: it rises in the year it was first studied and widens with the papers published on it each year. Pick a channel to see its streams.</p>
      <h3>Four channels <span class="n">click to open</span></h3><div class="rows">${chans}</div>
      <h3>Landmarks <span class="n">computed from the data</span></h3><div class="rows">${lm || '<p class="note">No landmarks match these filters.</p>'}</div>
      <p class="note">Rising = at least ${fmtPct(m.corpusShare + 0.15)} of its papers are from ${m.recentFrom}–${m.r1}; across all papers in range the share is ${fmtPct(m.corpusShare)}.</p>
      <h3>How to read it</h3>
      <div class="how">
        <div><span>left → right</span><span>publication year, ${m.r0}–${m.r1}. Drag on the timeline under the river to zoom into years.</span></div>
        <div><span>width</span><span>papers per year (3-year average). A paper about two tasks adds to both streams, so a channel's width counts mentions.</span></div>
        <div><span>channel</span><span>the four concept types, always in the same order.</span></div>
        <div><span>confluence</span><span>inside a concept, dots mark papers it shares with another concept, at the year they appeared.</span></div>
      </div>`;
  }

  function panelChannel(m, r) {
    const c = m.channels.find((x) => x.type.id === r.channel);
    const t = typeObj(r.channel);
    if (!c) return `<p class="eyebrow">Channel</p><h2>${esc(t.plural)}</h2><p class="note">This channel is hidden.</p>`;
    const max = c.nodes.length ? m.S(c.nodes[0]).total : 1;
    const rising = m.risingOf(c.nodes, Math.max(5, m.f.minPapers), 3);
    const oldest = c.nodes.slice().sort((a, b) => a.firstYear - b.firstYear || m.S(b).total - m.S(a).total).slice(0, 3);
    const rows = c.nodes.map((n, i) => {
      const key = !r.all && i >= TOP_N ? `${t.id}:__other` : `${t.id}:${n.id}`;
      return (i === TOP_N && !r.all ? `<p class="note" style="margin:8px 8px 4px">Merged into “${c.nodes.length - TOP_N} smaller streams”:</p>` : "") + rowConcept(n, m.S(n).total, max, `since ${n.firstYear}`, key);
    }).join("");
    return `<p class="eyebrow"><span class="sw" style="background:${t.color}"></span>Channel</p>
      <h2>${esc(t.plural)}</h2><p class="desc">${esc(t.definition)}</p>
      <div class="stats"><div class="stat"><div class="v">${c.nodes.length}</div><div class="l">streams in ${m.r0}–${m.r1}</div></div><div class="stat"><div class="v">${c.paperCount}</div><div class="l">papers</div></div></div>
      ${rising.length ? `<h3>Rising here</h3><div class="rows">${rising.map((x) => rowConcept(x.node, x.total, max, `${fmtPct(x.share)} since ${m.recentFrom}`, `${t.id}:${x.node.id}`)).join("")}</div>` : ""}
      ${oldest.length ? `<h3>Oldest sources</h3><div class="rows">${oldest.map((n) => rowConcept(n, m.S(n).total, max, `first ${n.firstYear}`, `${t.id}:${n.id}`)).join("")}</div>` : ""}
      <h3>All streams <span class="n">by papers in range</span></h3><div class="rows">${rows || `<p class="note">No ${esc(t.plural.toLowerCase())} in ${m.r0}–${m.r1} match these filters.</p>`}</div>`;
  }

  function panelConcept(m, r) {
    const n = atlas.byId.get(r.concept);
    const t = typeObj(n.type);
    const s = m.S(n);
    const nb = atlas.neighbors(n.id, m.f);
    const peakI = s.raw.indexOf(d3.max(s.raw));
    const share = m.recentShare(n);
    const trend = !s.total ? "–" : share - m.corpusShare >= 0.15 ? "rising" : m.corpusShare - share >= 0.15 ? "mostly older" : "steady";
    const tabs = ["all", ...TYPES.filter((x) => nb.some((y) => y.node.type === x.id)).map((x) => x.id)];
    if (!tabs.includes(state.tab)) state.tab = "all";
    const list = nb.filter((x) => state.tab === "all" || x.node.type === state.tab);
    const shown = state.showAllConn ? list : list.slice(0, 15);
    const max = list.length ? list[0].shared : 1;
    const conRows = shown.map((x) => `<button class="row" data-go="${esc(hashFor(R.link(n.id, x.node.id)))}" data-hl="lane:${esc(x.node.id)}">
        <span class="sw" style="background:${typeColor(x.node.type)}"></span><span class="nm">${esc(x.node.label)}</span>
        <span class="ct" style="color:${typeColor(x.node.type)}"><span class="bar" style="width:${Math.max(3, Math.round((x.shared / max) * 54))}px"></span><span style="color:var(--muted)">${x.shared}</span></span></button>`).join("");
    const papers = atlas.papersIn(n.papers, m.f).slice().sort((a, b) => b.year - a.year || String(a.title).localeCompare(String(b.title)));
    const pShown = state.showAllPapers ? papers : papers.slice(0, 12);
    return `<p class="eyebrow"><span class="sw" style="background:${t.color}"></span>${esc(t.label)}</p>
      <h2>${esc(n.label)}</h2>${n.description ? `<p class="desc">${esc(n.description)}</p>` : ""}
      <div class="stats">
        <div class="stat"><div class="v">${s.total}</div><div class="l">papers in ${m.r0}–${m.r1}</div></div>
        <div class="stat"><div class="v">${n.firstYear ?? "–"}</div><div class="l">first studied</div></div>
        <div class="stat"><div class="v">${s.total ? m.years[peakI] : "–"}</div><div class="l">peak year${s.total ? ` (${plural(s.raw[peakI], "paper")})` : ""}</div></div>
        <div class="stat"><div class="v">${s.total ? fmtPct(share) : "–"}</div><div class="l">since ${m.recentFrom} · ${trend} (all: ${fmtPct(m.corpusShare)})</div></div>
      </div>
      <h3>Confluences <span class="n">${plural(nb.length, "connected concept")}, by shared papers</span></h3>
      ${nb.length ? `<div class="tabs">${tabs.map((id) => `<button data-tab="${id}" class="${state.tab === id ? "on" : ""}">${id === "all" ? "All" : esc(typeObj(id).plural)} ${id === "all" ? nb.length : nb.filter((y) => y.node.type === id).length}</button>`).join("")}</div>
        <div class="rows">${conRows}</div>${list.length > shown.length ? `<button class="more" data-act="allConn">Show all ${list.length}</button>` : ""}`
        : `<p class="note">${n.degree ? `No connections in ${m.r0}–${m.r1} with these filters.` : "This concept has no connections in the data (one-paper concepts, and two catch-alls whose links the export leaves out)."}</p>`}
      <h3>Papers <span class="n">${papers.length}, newest first</span></h3>
      <div class="rows">${pShown.map((p) => paperRow(p, { concept: n.id, paper: p.paper_id })).join("") || `<p class="note">No papers in ${m.r0}–${m.r1}.</p>`}</div>
      ${papers.length > pShown.length ? `<button class="more" data-act="allPapers">Show all ${papers.length} papers</button>` : ""}`;
  }

  function miniTimeline(m, papers, ctx) {
    const w = 320, h = 74;
    const x = d3.scaleLinear().domain([m.r0 - 0.5, m.r1 + 0.5]).range([6, w - 6]);
    const byYear = d3.group(papers, (p) => p.year);
    const maxN = d3.max([...byYear.values()], (v) => v.length) || 1;
    const sp = Math.min(7, 50 / maxN);
    const r = Math.min(3, sp / 2 + 0.3);
    let dots = "";
    byYear.forEach((ps, yr) => ps.forEach((p, j) => {
      dots += `<circle class="md" data-go="${esc(hashFor({ ...ctx, paper: p.paper_id }))}" cx="${x(yr).toFixed(1)}" cy="${(h - 20 - r - j * sp).toFixed(1)}" r="${r.toFixed(1)}" fill="${ctx.color}" stroke="#151820" stroke-width="0.8"><title>${esc(`${p.year} · ${paperTitle(p)}`)}</title></circle>`;
    }));
    const step = [2, 5, 10].find((s) => (m.r1 - m.r0) / s <= 6) || 10;
    let ticks = "";
    d3.range(Math.ceil(m.r0 / step) * step, m.r1 + 1, step).forEach((y) => { ticks += `<text x="${x(y)}" y="${h - 4}" text-anchor="middle">${y}</text><line x1="${x(y)}" x2="${x(y)}" y1="${h - 17}" y2="${h - 14}" stroke="#3a4152"/>`; });
    return `<div class="mini"><svg viewBox="0 0 ${w} ${h}" height="${h}"><line x1="6" x2="${w - 6}" y1="${h - 17}" y2="${h - 17}" stroke="#3a4152"/>${ticks}${dots}</svg></div>`;
  }

  function panelLink(m, r) {
    const ex = atlas.explainConnection(r.concept, r.other, m.f);
    const a = ex.a, b = ex.b;
    const chip = (n) => `<button class="cchip" data-go="${esc(hashFor(R.concept(n.id)))}"><span class="sw" style="background:${typeColor(n.type)}"></span>${esc(n.label)}</button>`;
    let sentence = esc(ex.sentence);
    [a, b].forEach((n) => { sentence = sentence.replace(esc(n.label), `<b style="color:${d3.color(typeColor(n.type)).brighter(0.3)}">${esc(n.label)}</b>`); });
    const along = ex.alongside.slice(0, 8);
    const papers = ex.papers;
    const pShown = state.showAllPapers ? papers : papers.slice(0, 12);
    return `<p class="eyebrow">Connection</p>
      <div class="pair">${chip(a)}<span class="x">and</span>${chip(b)}</div>
      ${ex.n ? `<p class="sentence">${sentence}.</p>` : `<p class="sentence">No shared papers in ${m.r0}–${m.r1}.</p>`}
      ${ex.n ? `<div class="stats">
        <div class="stat"><div class="v">${ex.n}</div><div class="l">shared ${ex.n === 1 ? "paper" : "papers"}</div></div>
        <div class="stat"><div class="v">${ex.lift ? ex.lift.toFixed(1) + "×" : "–"}</div><div class="l">vs. chance</div></div>
        <div class="stat"><div class="v">${fmtPct(ex.shareOfA)}</div><div class="l">of ${esc(a.label)}'s papers</div></div>
        <div class="stat"><div class="v">${fmtPct(ex.shareOfB)}</div><div class="l">of ${esc(b.label)}'s papers</div></div>
      </div>
      <h3>How strong</h3><p>${liftPhrase(ex)}</p>
      <h3>When they met <span class="n">each dot is a shared paper</span></h3>
      ${miniTimeline(m, papers, { concept: a.id, other: b.id, color: d3.color(typeColor(b.type)).brighter(0.4) })}
      <p class="note" style="margin-top:6px">${esc(ex.trend)}</p>
      ${along.length ? `<h3>What else these papers study</h3><div class="chips">${along.map((x) => `<button class="cchip" data-go="${esc(hashFor(R.concept(x.node.id)))}"><span class="sw" style="background:${typeColor(x.node.type)}"></span>${esc(x.node.label)} <span class="c">${x.count}</span></button>`).join("")}</div>` : ""}
      <h3>Shared papers <span class="n">newest first</span></h3>
      <div class="rows">${pShown.map((p) => paperRow(p, { concept: a.id, other: b.id, paper: p.paper_id })).join("")}</div>
      ${papers.length > pShown.length ? `<button class="more" data-act="allPapers">Show all ${papers.length} papers</button>` : ""}` : `<button class="text-btn" data-act="clearYears">Show all years</button>`}`;
  }

  function panelPaper(m, r) {
    const p = atlas.paperById.get(r.paper);
    if (!p) return `<p class="note">Paper not found.</p>`;
    const concepts = atlas.conceptsOfPaper(p.paper_id);
    const groups = TYPES.map((t) => ({ t, ns: concepts.filter((n) => n.type === t.id) })).filter((g) => g.ns.length);
    const related = atlas.relatedPapers(p.paper_id, 6);
    const outside = p.year < m.r0 || p.year > m.r1;
    return `<p class="eyebrow">Paper · ${p.year}</p>
      ${outside ? `<p class="warn">Published outside the current year range (${m.r0}–${m.r1}).</p>` : ""}
      <h2>${esc(paperTitle(p))}</h2>
      <p class="lede">${esc(p.authors || "Authors unknown")} · ${p.year} · ASME IDETC/CIE, Design Theory and Methodology</p>
      <a class="scholar" href="${esc(atlas.paperLink(p))}" target="_blank" rel="noopener">Find on Google Scholar ↗</a>
      <p class="note">The Atlas has no DOIs or abstracts, so this is a title search.</p>
      <h3>Concepts in this paper <span class="n">jump to any stream</span></h3>
      ${groups.map((g) => `<p class="note" style="margin:8px 0 5px">${esc(g.t.plural)}</p><div class="chips">${g.ns.map((n) => `<button class="cchip" data-go="${esc(hashFor(R.concept(n.id)))}"><span class="sw" style="background:${g.t.color}"></span>${esc(n.label)}</button>`).join("")}</div>`).join("")}
      <h3>Related papers <span class="n">most concepts in common</span></h3>
      <div class="rows">${related.map((x) => paperRow(x.paper, { concept: r.concept, other: r.other, channel: r.channel, paper: x.paper.paper_id }, `<span class="shared">shares ${esc(x.shared.slice(0, 3).map((n) => n.label).join(", "))}${x.shared.length > 3 ? ` +${x.shared.length - 3}` : ""}</span>`)).join("")}</div>`;
  }

  // panel interactions
  const panel = $("#panel");
  panel.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); state.navCount++; location.hash = g.getAttribute("data-go"); return; }
    const tb = e.target.closest("[data-tab]");
    if (tb) { state.tab = tb.dataset.tab; state.showAllConn = false; renderPanel(lastModel); return; }
    const act = e.target.closest("[data-act]");
    if (act) {
      if (act.dataset.act === "allConn") state.showAllConn = true;
      if (act.dataset.act === "allPapers") state.showAllPapers = true;
      if (act.dataset.act === "clearYears") return setFilter((f) => { f.range = [Y0, Y1]; });
      const st = panel.scrollTop;
      renderPanel(lastModel);
      panel.scrollTop = st;
    }
  });
  panel.addEventListener("mouseover", (e) => {
    const h = e.target.closest("[data-hl]");
    hlCanvas(h ? h.getAttribute("data-hl") : null);
  });
  panel.addEventListener("mouseleave", () => hlCanvas(null));
  $("#crumbs").addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) { state.navCount++; location.hash = g.getAttribute("data-go"); }
  });

  // ---------- Render ----------
  let lastModel = null;
  function render(animate, live = false) {
    const wrap = $("#plotWrap");
    W = wrap.clientWidth; H = wrap.clientHeight;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    plotTop = M.t; plotBot = H - M.b;
    M.r = state.route.channel && !state.route.concept && state.filter.types.has(state.route.channel) ? Math.round(clamp(W * 0.16, 130, 190)) : 22;
    const m = buildModel();
    lastModel = m;
    years = m.years;
    X = d3.scaleLinear().domain([m.r0 - 0.4, m.r1 + 0.4]).range([plotL(), plotR()]);
    const L = layout(m);
    svg.node().classList.remove("dim");
    draw(L, animate);
    renderFilters(m);
    renderLegend();
    renderCrumbs();
    if (!live || !brushing) renderOverview();
    else ovBars.selectAll("rect").attr("class", (d) => `ov-bar ${d.y >= m.r0 && d.y <= m.r1 ? "in" : ""}`);
    renderPanel(m);
  }

  // ---------- Search ----------
  const q = $("#q"), results = $("#results");
  let hits = [], active = 0;
  function renderResults() {
    const text = q.value.trim();
    if (!text) { results.hidden = true; return; }
    hits = atlas.search(text, 8);
    active = clamp(active, 0, Math.max(0, hits.length - 1));
    results.hidden = false;
    results.innerHTML = hits.length
      ? hits.map((n, i) => `<button role="option" class="${i === active ? "active" : ""}" data-i="${i}"><span class="sw" style="width:8px;height:8px;border-radius:50%;background:${typeColor(n.type)}"></span><span class="lbl">${esc(n.label)}</span><span class="meta">${esc(typeObj(n.type).label.toLowerCase())} · ${n.paperCount}</span></button>`).join("")
      : `<div class="none">No concept matches “${esc(text)}”.</div>`;
  }
  function pick(n) {
    if (!n) return;
    q.value = ""; results.hidden = true; q.blur();
    if (!state.filter.types.has(n.type)) state.filter.types.add(n.type);
    go(R.concept(n.id));
  }
  q.addEventListener("input", () => { active = 0; renderResults(); });
  q.addEventListener("focus", renderResults);
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); renderResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); renderResults(); e.preventDefault(); }
    else if (e.key === "Enter") { pick(hits[active]); e.preventDefault(); }
    else if (e.key === "Escape") { q.value = ""; results.hidden = true; q.blur(); e.stopPropagation(); }
  });
  results.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); pick(hits[+b.dataset.i]); } });
  q.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 120));

  // ---------- Global controls ----------
  function goUp() { go(parentOf(state.route)); }
  $("#back").addEventListener("click", () => {
    if (state.navCount > 0) { state.navCount--; history.back(); }
    else goUp();
  });
  $("#reset").addEventListener("click", () => {
    state.filter = atlas.defaultFilter();
    if (location.hash === "#/" || location.hash === "") { history.replaceState(null, "", "#/"); state.route = {}; render(true); }
    else go({});
  });
  const about = $("#aboutPop");
  $("#about").addEventListener("click", (e) => { e.stopPropagation(); about.hidden = !about.hidden; });
  document.addEventListener("click", (e) => { if (!about.hidden && !about.contains(e.target)) about.hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (e.target === q) return;
    if (e.key === "/" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); q.focus(); return; }
    if (e.key === "Escape") {
      if (!about.hidden) { about.hidden = true; return; }
      const r = state.route;
      if (r.channel || r.paper != null) goUp();
    }
  });
  window.addEventListener("hashchange", () => onHash(false));
  let resizeT = null;
  new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => render(false), 60); }).observe($("#plotWrap"));

  try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
  onHash(true);
})();
