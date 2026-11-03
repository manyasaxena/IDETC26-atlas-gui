// Strata: the four concept types as four stacked layers (the anatomy of a study).
// Exploring = drilling a core sample down through the layers; the sample holds the papers that
// cover every concept picked so far. Rendering is plain SVG with a hand-rolled 3D projection, so
// the "Tilted" and "Flat" views are the same points under two projections, blended by `tilt`.
(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const NS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let atlas;
  try {
    atlas = await AtlasCore.load();
  } catch (e) {
    $("#loading").textContent = e.message;
    return;
  }
  $("#loading").remove();
  const { esc, plural, paperTitle, cap } = atlas.text;
  const TYPES = atlas.types; // schema order = layer order, top to bottom
  const QUESTION = { subject: "who is studied", task: "what they do", problem: "what they work on", construct: "what is measured" };
  const fmt = (n) => n.toLocaleString("en-US");

  // ---------- Geometry ----------
  const B = 0.55;          // half-depth of a plane (world units); half-width is 1
  const S_TILT = 0.74;     // vertical spacing between planes when tilted
  const S_FLAT = 0.68;     // spacing when flat
  const FLAT_DEPTH = 0.5;  // flat view squashes depth by this factor (bands don't overlap)
  const FLAT_W = 1.55; // flat view is wider so the bands read as strips
  const CAM = 4.6;         // camera distance for perspective
  const YEAR_POW = 1.7;    // recent years get more room: x = u^1.7

  // Neighborhood -> depth band. Biggest neighborhoods at the front, the unlinked group at the back.
  const clusterOrder = atlas.clusters.filter((c) => !c.unlinked).concat(atlas.clusters.filter((c) => c.unlinked));
  const bandOf = new Map(clusterOrder.map((c, i) => [c.id, i]));
  const NB = clusterOrder.length;

  // ---------- State ----------
  const view = { tilt: 1, yaw: -0.3, pitch: 0.4 }; // target view params
  const cur = { tilt: 1, yaw: -0.3, pitch: 0.4, k: 300, ox: 400, oy: 400 };
  const tgt = { k: 300, ox: 400, oy: 400 };
  let state = null;     // parsed route
  let F = atlas.defaultFilter();
  let layoutKey = "";
  const NS_ = new Map(); // per node render state
  atlas.nodes.forEach((n) => NS_.set(n.id, {
    n, x: 0, z: 0, y: 0, r: 0, op: 0, tx: 0, tz: 0, ty: 0, tr: 0, top: 0, ring: 0, tring: 0, visible: false
  }));
  const layerY = new Map(TYPES.map((t) => [t.id, { y: 0, ty: 0, yf: 0, tyf: 0, op: 1, top: 1 }]));
  let threads = [];   // {a, b, w, key, color, core}
  let labelIds = [];  // node ids that get a permanent label, in priority order
  let hoverId = null;
  let model = null;   // derived data for the current route

  // ---------- Routing ----------
  // #/s/<id>,<id>[/c/<a>~<b> | /p/<paperId>]?y=1990-2025&m=2&off=task&flat=1
  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [path, query = ""] = h.split("?");
    const seg = path.split("/").filter(Boolean);
    const st = { chain: [], link: null, paper: null };
    for (let i = 0; i < seg.length; i += 2) {
      const k = seg[i], v = seg[i + 1] || "";
      if (k === "s") st.chain = v.split(",").filter((id) => atlas.byId.has(id));
      if (k === "c") { const [a, b] = v.split("~"); if (atlas.byId.has(a) && atlas.byId.has(b)) st.link = [a, b]; }
      if (k === "p") { const p = atlas.paperById.get(Number(v)) || atlas.paperById.get(v); if (p) st.paper = p.paper_id; }
    }
    // one concept per layer
    const seen = new Set();
    st.chain = st.chain.filter((id) => { const t = atlas.byId.get(id).type; if (seen.has(t)) return false; seen.add(t); return true; });
    const q = new URLSearchParams(query);
    const f = atlas.defaultFilter();
    const y = (q.get("y") || "").split("-").map(Number);
    if (y.length === 2 && y[0] >= atlas.Y0 && y[1] <= atlas.Y1 && y[0] <= y[1]) f.range = y;
    const m = Number(q.get("m"));
    if (m > 1) f.minPapers = Math.min(50, Math.floor(m));
    (q.get("off") || "").split(",").forEach((t) => f.types.delete(t));
    if (!f.types.size) TYPES.forEach((t) => f.types.add(t.id));
    st.filter = f;
    st.flat = q.get("flat") === "1";
    return st;
  }
  function buildHash(st) {
    let h = "#/";
    if (st.chain.length) h += `s/${st.chain.map(encodeURIComponent).join(",")}`;
    if (st.link) h += `${st.chain.length ? "/" : ""}c/${st.link.map(encodeURIComponent).join("~")}`;
    else if (st.paper != null) h += `${st.chain.length ? "/" : ""}p/${st.paper}`;
    const q = new URLSearchParams();
    const f = st.filter;
    if (atlas.rangeActive(f)) q.set("y", f.range.join("-"));
    if (f.minPapers > 1) q.set("m", f.minPapers);
    const off = TYPES.filter((t) => !f.types.has(t.id)).map((t) => t.id);
    if (off.length) q.set("off", off.join(","));
    if (st.flat) q.set("flat", "1");
    const qs = q.toString();
    return h + (qs ? `?${qs}` : "");
  }
  function go(patch, replace = false) {
    const next = { ...state, ...patch };
    const h = buildHash(next);
    if (h === location.hash || (h === "#/" && !location.hash)) { if (patch) route(); return; }
    if (replace) { history.replaceState(null, "", h); route(); }
    else location.hash = h;
  }
  window.addEventListener("hashchange", route);

  // ---------- Chain helpers ----------
  const typeIdx = (id) => atlas.typeRank(atlas.byId.get(id).type);
  const layerOrdered = (chain) => chain.slice().sort((a, b) => typeIdx(a) - typeIdx(b));
  function addToChain(id) {
    const node = atlas.byId.get(id);
    let chain = state.chain.filter((c) => c !== id && atlas.byId.get(c).type !== node.type);
    chain.push(id);
    const f = state.filter;
    if (!f.types.has(node.type)) { f.types.add(node.type); }
    go({ chain, link: null, paper: null, filter: f });
  }
  function removeFromChain(id) { go({ chain: state.chain.filter((c) => c !== id), link: null, paper: null }); }
  const rangeText = (f) => `${f.range[0]}–${f.range[1]}`;

  // ---------- Layout (recomputed when filters change) ----------
  const xOfYear = (y, f) => {
    const [a, b] = f.range;
    const u = b > a ? Math.min(1, Math.max(0, (y - a) / (b - a))) : 0.5;
    return -0.94 + 1.88 * Math.pow(u, YEAR_POW);
  };
  let maxCount = 1;
  function computeLayout(f) {
    maxCount = Math.max(1, ...atlas.nodes.map((n) => atlas.countOf(n, f)));
    const visTypes = TYPES.filter((t) => f.types.has(t.id));
    visTypes.forEach((t, k) => {
      const L = layerY.get(t.id);
      L.ty = ((visTypes.length - 1) / 2 - k) * S_TILT;
      L.tyf = ((visTypes.length - 1) / 2 - k) * S_FLAT;
      L.top = 1;
    });
    TYPES.filter((t) => !f.types.has(t.id)).forEach((t) => { layerY.get(t.id).top = 0; });

    TYPES.forEach((t) => {
      const items = [];
      atlas.nodes.filter((n) => n.type === t.id).forEach((n) => {
        const s = NS_.get(n.id);
        const ps = atlas.papersIn(n.papers, f);
        s.count = ps.length;
        s.visible = f.types.has(t.id) && atlas.nodeVisible(n, f);
        if (!ps.length) { s.medianYear = null; s.tr = 0; return; }
        const ys = ps.map((p) => p.year).sort((a, b) => a - b);
        s.medianYear = ys[Math.floor(ys.length / 2)];
        s.tr = 2.4 + 17 * Math.sqrt(s.count / maxCount);
        if (!s.visible) return;
        const band = bandOf.get(n.cluster) ?? NB - 1;
        // plane units: x in [-1,1]*500, z in [-B,B]*500 compressed by FLAT_DEPTH for packing
        items.push({ s, tx: xOfYear(s.medianYear, f) * 500, tz: (-B + (band + 0.5) / NB * 2 * B) * 500 * FLAT_DEPTH, r: s.tr * 1.18 + 1.5 });
      });
      // simple collision relaxation: x pulled hard to its year, z loosely to its neighborhood band
      items.forEach((it) => { it.x = it.tx; it.z = it.tz; });
      const zMax = B * 500 * FLAT_DEPTH;
      for (let iter = 0; iter < 140; iter++) {
        items.forEach((it) => { it.x += (it.tx - it.x) * 0.12; it.z += (it.tz - it.z) * 0.03; });
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          let dx = b.x - a.x, dz = b.z - a.z;
          const d = Math.hypot(dx, dz) || 0.01, min = a.r + b.r;
          if (d < min) {
            const push = (min - d) / 2;
            if (d < 0.02) { dx = 0; dz = 1; }
            const ux = dx / d, uz = dz / d;
            // move mostly along depth so the year position stays honest
            a.x -= ux * push * 0.35; b.x += ux * push * 0.35;
            a.z -= uz * push * 1.0; b.z += uz * push * 1.0;
          }
        }
        items.forEach((it) => { it.z = Math.max(-zMax + it.r * 0.6, Math.min(zMax - it.r * 0.6, it.z)); it.x = Math.max(-500, Math.min(500, it.x)); });
      }
      items.forEach((it) => { it.s.tx = it.x / 500; it.s.tz = it.z / 500 / FLAT_DEPTH; });
    });
  }

  // ---------- Projection ----------
  function projRaw(X, Z, type, v) {
    const L = layerY.get(type);
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
    const x1 = X * cy + Z * sy, z1 = -X * sy + Z * cy;
    const up = L.y * cp + z1 * sp, d = z1 * cp - L.y * sp;
    const p = CAM / (CAM + d);
    const tx = x1 * p, ty = up * p;
    const fx = X * FLAT_W, fy = L.yf + Z * FLAT_DEPTH;
    const t = v.tilt;
    return [tx * t + fx * (1 - t), ty * t + fy * (1 - t), p * t + (1 - t)];
  }
  const toScreen = (q) => [cur.ox + q[0] * cur.k, cur.oy - q[1] * cur.k, q[2]];
  const proj = (X, Z, type) => toScreen(projRaw(X, Z, type, cur));

  // Fit the visible planes into the stage, leaving room for the layer headers on the left.
  function fit(useTarget) {
    const W = $("#stage").clientWidth, H = $("#stage").clientHeight;
    const v = useTarget ? view : cur;
    // compute with target layer heights
    const saved = new Map();
    layerY.forEach((L, k) => { saved.set(k, [L.y, L.yf]); if (useTarget) { L.y = L.ty; L.yf = L.tyf; } });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    TYPES.filter((t) => state.filter.types.has(t.id)).forEach((t) => {
      [[-1, -B], [1, -B], [1, B], [-1, B]].forEach(([X, Z]) => {
        const q = projRaw(X, Z, t.id, v);
        x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
      });
    });
    layerY.forEach((L, k) => { [L.y, L.yf] = saved.get(k); });
    const tb = $("#toolbar").offsetHeight + 10;
    const hint = $("#hint");
    hint.style.top = `${tb + 6}px`;
    const left = Math.min(200, W * 0.2), right = 28, top = tb + (hint.textContent ? 52 : 24), bottom = Math.min(120, H * 0.16);
    const k = Math.min((W - left - right) / (x1 - x0), (H - top - bottom) / (y1 - y0));
    tgt.k = k;
    tgt.ox = left + (W - left - right - (x1 - x0) * k) / 2 - x0 * k;
    tgt.oy = top + (H - top - bottom - (y1 - y0) * k) / 2 + y1 * k;
  }

  // ---------- Model for a route ----------
  function buildModel() {
    const f = state.filter;
    const chain = state.chain.filter((id) => f.types.has(atlas.byId.get(id).type));
    const ordered = layerOrdered(chain);
    const focus = chain[chain.length - 1] || null;
    const sample = atlas.papersWithAll(chain, f);
    const steps = ordered.map((id, i) => ({ id, count: atlas.papersWithAll(ordered.slice(0, i + 1), f).length }));
    // how many sample papers include each other concept
    const cand = new Map();
    if (chain.length) sample.forEach((p) => atlas.conceptsOfPaper(p.paper_id).forEach((n) => {
      if (!chain.includes(n.id) && NS_.get(n.id).visible) cand.set(n.id, (cand.get(n.id) || 0) + 1);
    }));
    const chainTypes = new Set(chain.map((id) => atlas.byId.get(id).type));
    const visTypes = TYPES.filter((t) => f.types.has(t.id));
    const byLayer = new Map(visTypes.map((t) => [t.id, []]));
    cand.forEach((c, id) => byLayer.get(atlas.byId.get(id).type)?.push({ node: atlas.byId.get(id), count: c }));
    byLayer.forEach((list) => list.sort((a, b) => b.count - a.count || a.node.label.localeCompare(b.node.label)));
    // anchor for a layer: the chain concept in the nearest layer (ties go upward)
    const visIdx = (type) => visTypes.findIndex((t) => t.id === type);
    const anchorFor = (type) => {
      let best = null, bd = Infinity;
      ordered.forEach((id) => {
        const d = Math.abs(visIdx(atlas.byId.get(id).type) - visIdx(type)) + (visIdx(atlas.byId.get(id).type) > visIdx(type) ? 0.1 : 0);
        if (d < bd) { bd = d; best = id; }
      });
      return best;
    };
    // gap suggestions
    let suggestions = [];
    if (chain.length >= 2 && sample.length === 0) {
      ordered.forEach((id) => {
        const rest = ordered.filter((c) => c !== id);
        const base = atlas.papersWithAll(rest, f);
        suggestions.push({ kind: "drop", drop: id, chain: rest, n: base.length, recency: chain.indexOf(id) });
        const t = atlas.byId.get(id).type;
        const alt = new Map();
        base.forEach((p) => atlas.conceptsOfPaper(p.paper_id).forEach((n) => { if (n.type === t && NS_.get(n.id).visible) alt.set(n.id, (alt.get(n.id) || 0) + 1); }));
        const bestAlt = [...alt].sort((a, b) => b[1] - a[1])[0];
        if (bestAlt) suggestions.push({ kind: "swap", drop: id, add: bestAlt[0], chain: rest.concat(bestAlt[0]), n: bestAlt[1], recency: chain.indexOf(id) });
      });
      // prefer swaps (same depth of sample) of the most recent pick, then the biggest drops
      suggestions.sort((a, b) => (a.kind === b.kind ? (b.recency - a.recency) || (b.n - a.n) : a.kind === "swap" ? -1 : 1));
      suggestions = suggestions.filter((s) => s.n > 0).slice(0, 3);
    }
    return { f, chain, ordered, focus, sample, steps, cand, chainTypes, visTypes, byLayer, anchorFor, suggestions };
  }

  // ---------- Route ----------
  function route() {
    state = parseHash();
    F = state.filter;
    view.tilt = state.flat ? 0 : 1;
    const key = JSON.stringify([F.range, F.minPapers, [...F.types].sort()]);
    if (key !== layoutKey) { layoutKey = key; computeLayout(F); }
    model = buildModel();
    computeTargets();
    renderStatic();
    renderPanel();
    renderCrumbs();
    renderControls();
    renderLegend();
    fit(true);
    kick();
  }

  function computeTargets() {
    const m = model;
    const maxCand = Math.max(1, ...m.cand.values());
    threads = [];
    labelIds = [];
    NS_.forEach((s, id) => {
      const n = s.n;
      s.tring = 0; s.hl = false;
      if (!s.visible) { s.top = 0; return; }
      if (!m.chain.length) { s.top = 0.3; return; }
      if (m.chain.includes(id)) { s.top = 1; s.tring = s.tr + 6; return; }
      const c = m.cand.get(id) || 0;
      if (c && !m.chainTypes.has(n.type)) s.top = 0.35 + 0.65 * Math.sqrt(c / maxCand);
      else if (c) s.top = 0.22; // same-layer alternatives present in the sample
      else s.top = 0.07;
    });
    if (!m.chain.length) {
      // landing: the top three landmarks of each layer
      m.visTypes.forEach((t) => {
        atlas.nodes.filter((n) => n.type === t.id && NS_.get(n.id).visible)
          .sort((a, b) => NS_.get(b.id).count - NS_.get(a.id).count).slice(0, 3)
          .forEach((n) => { labelIds.push(n.id); NS_.get(n.id).top = 1; });
      });
      threads.maxW = 1;
      addFocusExtras();
      return;
    }
    labelIds.push(...m.ordered);
    // drill path through the chain, in layer order
    for (let i = 1; i < m.ordered.length; i++) {
      threads.push({ a: m.ordered[i - 1], b: m.ordered[i], w: m.steps[m.steps.length - 1].count, core: true, key: `core:${m.ordered[i - 1]}:${m.ordered[i]}` });
    }
    m.visTypes.forEach((t) => {
      if (m.chainTypes.has(t.id)) return;
      const list = m.byLayer.get(t.id) || [];
      const anchor = m.anchorFor(t.id);
      list.slice(0, 10).forEach((c, i) => {
        threads.push({ a: anchor, b: c.node.id, w: c.count, key: `t:${anchor}:${c.node.id}`, color: atlas.colorOf(t.id) });
        if (i < 4 && !state.link && state.paper == null) labelIds.push(c.node.id);
      });
    });
    threads.maxW = Math.max(1, ...threads.filter((t) => !t.core && !t.hl).map((t) => t.w));
    addFocusExtras();
  }
  // A connection or paper being read is also drawn in the strata: its concepts ringed in blue,
  // joined by a dashed blue thread.
  function addFocusExtras() {
    let ids = [];
    if (state.link) ids = state.link.slice();
    else if (state.paper != null) ids = layerOrdered(atlas.conceptsOfPaper(state.paper).map((n) => n.id));
    ids = ids.filter((id) => NS_.get(id).visible);
    ids.forEach((id) => {
      const s = NS_.get(id);
      s.top = 1;
      if (!s.tring) { s.tring = s.tr + 5; s.hl = true; }
      if (!labelIds.includes(id)) labelIds.unshift(id);
    });
    for (let i = 1; i < ids.length; i++) {
      threads.push({ a: ids[i - 1], b: ids[i], w: 1, hl: true, key: `hl:${ids[i - 1]}:${ids[i]}` });
    }
    threads.maxW = threads.maxW || 1;
  }

  // ---------- SVG: static structure (rebuilt on route) ----------
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const gPlanes = $("#g-planes"), gGrid = $("#g-grid"), gThreads = $("#g-threads"), gCore = $("#g-core"), gNodes = $("#g-nodes"), gLabels = $("#g-labels");
  const planeEls = new Map(), headEls = new Map(), nodeEls = new Map();
  TYPES.forEach((t) => {
    const g = el("g", {}, gPlanes);
    const poly = el("polygon", { fill: t.color, "fill-opacity": 0.045, stroke: t.color, "stroke-opacity": 0.35, "stroke-width": 1 }, g);
    const front = el("line", { stroke: t.color, "stroke-opacity": 0.7, "stroke-width": 1.5 }, g);
    const empty = el("text", { class: "plane-empty", "text-anchor": "middle" }, g);
    planeEls.set(t.id, { g, poly, front, empty });
    const h = document.createElement("div");
    h.className = "lhead";
    $("#layer-heads").appendChild(h);
    headEls.set(t.id, h);
  });
  // nodes: draw bigger first so small ones stay on top
  atlas.nodes.slice().sort((a, b) => b.paperCount - a.paperCount).forEach((n) => {
    const g = el("g", {}, gNodes);
    const ring = el("circle", { fill: "none", stroke: "#fff", "stroke-width": 1.6, "stroke-opacity": 0.9, filter: "url(#glow)" }, g);
    const c = el("circle", { fill: atlas.colorOf(n.type) }, g);
    const hit = el("circle", { class: "node-hit" }, g);
    hit.addEventListener("pointerenter", (e) => { hoverId = n.id; showTip(e, n.id); kick(); });
    hit.addEventListener("pointermove", (e) => moveTip(e));
    hit.addEventListener("pointerleave", () => { hoverId = null; hideTip(); kick(); });
    hit.addEventListener("click", (e) => { if (dragMoved) return; e.stopPropagation(); onNodeClick(n.id); });
    nodeEls.set(n.id, { g, ring, c, hit });
  });

  function onNodeClick(id) {
    hideTip();
    if (state.chain.includes(id)) {
      if (state.chain[state.chain.length - 1] === id && !state.link && state.paper == null) return;
      go({ chain: state.chain.filter((c) => c !== id).concat(id), link: null, paper: null });
    } else addToChain(id);
  }

  let threadEls = new Map();
  function renderStatic() {
    // threads: keyed join
    const next = new Map();
    threads.forEach((t) => {
      let e = threadEls.get(t.key);
      if (!e) {
        const g = el("g", {}, t.core || t.hl ? gCore : gThreads);
        const path = el("path", { class: "thread" }, g);
        const hit = el("path", { class: "thread-hit" }, g);
        path.style.opacity = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => { path.style.opacity = ""; }));
        hit.addEventListener("pointerenter", (ev) => { e.hover = true; showThreadTip(ev, e.t); kick(); });
        hit.addEventListener("pointermove", (ev) => moveTip(ev));
        hit.addEventListener("pointerleave", () => { e.hover = false; hideTip(); kick(); });
        hit.addEventListener("click", (ev) => { if (dragMoved) return; ev.stopPropagation(); hideTip(); go({ link: [e.t.a, e.t.b], paper: null }); });
        e = { g, path, hit, hover: false };
      }
      e.t = t;
      const w = t.core ? 4 : t.hl ? 2.2 : 1 + 5 * Math.sqrt(t.w / threads.maxW);
      e.path.setAttribute("stroke", t.core ? "#ffffff" : t.hl ? "#8bc5ff" : t.color);
      e.path.setAttribute("stroke-width", w);
      e.path.setAttribute("stroke-opacity", t.core ? 0.85 : t.hl ? 0.95 : 0.5);
      if (t.hl) e.path.setAttribute("stroke-dasharray", "5 5"); else e.path.removeAttribute("stroke-dasharray");
      if (t.core) e.path.setAttribute("filter", "url(#glow)"); else e.path.removeAttribute("filter");
      next.set(t.key, e);
    });
    threadEls.forEach((e, k) => { if (!next.has(k)) e.g.remove(); });
    threadEls = next;
    // node ring sizes start large so a new pick "drops" in
    NS_.forEach((s) => { if (s.tring && !s.ring) s.ring = s.tring + 34; });
  }

  // ---------- Frame ----------
  let raf = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    const a = reduceMotion ? 1 : 0.16;
    let moving = false;
    const ease = (o, k, t, eps = 0.0005) => { const d = t - o[k]; if (Math.abs(d) > eps) { o[k] += d * a; moving = true; } else o[k] = t; };
    ease(cur, "tilt", view.tilt, 0.001); ease(cur, "yaw", view.yaw); ease(cur, "pitch", view.pitch);
    ease(cur, "k", tgt.k, 0.2); ease(cur, "ox", tgt.ox, 0.2); ease(cur, "oy", tgt.oy, 0.2);
    layerY.forEach((L) => { ease(L, "y", L.ty); ease(L, "yf", L.tyf); ease(L, "op", L.top, 0.005); });
    NS_.forEach((s) => {
      ease(s, "x", s.tx); ease(s, "z", s.tz); ease(s, "r", s.visible ? s.tr : 0, 0.05); ease(s, "op", s.top, 0.004); ease(s, "ring", s.tring, 0.05);
    });
    draw();
    if (moving) kick();
  }

  function draw() {
    const f = state.filter;
    // planes
    const headYs = [];
    TYPES.forEach((t) => {
      const P = planeEls.get(t.id), L = layerY.get(t.id);
      const c = [[-1, -B], [1, -B], [1, B], [-1, B]].map(([X, Z]) => proj(X, Z, t.id));
      P.poly.setAttribute("points", c.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
      P.front.setAttribute("x1", c[0][0]); P.front.setAttribute("y1", c[0][1]); P.front.setAttribute("x2", c[1][0]); P.front.setAttribute("y2", c[1][1]);
      P.g.style.opacity = L.op;
      P.g.style.display = L.op < 0.02 ? "none" : "";
      const any = model && atlas.nodes.some((n) => n.type === t.id && NS_.get(n.id).visible);
      if (!any && f.types.has(t.id)) {
        const m = proj(0, 0, t.id);
        P.empty.setAttribute("x", m[0]); P.empty.setAttribute("y", m[1] + 4);
        P.empty.textContent = `No ${t.plural.toLowerCase()} in ${rangeText(f)} with at least ${plural(f.minPapers, "paper")}`;
      } else P.empty.textContent = "";
      // header to the left of the plane's left edge
      const h = headEls.get(t.id);
      const lm = proj(-1, 0, t.id), lf = proj(-1, -B, t.id);
      h.style.left = `${Math.min(lm[0], lf[0]) - 16}px`;
      h.style.top = `${(lm[1] + lf[1]) / 2}px`;
      h.style.opacity = L.op;
      h.style.display = L.op < 0.02 ? "none" : "";
      if (L.op > 0.5) headYs.push((lm[1] + lf[1]) / 2);
    });
    let minGap = Infinity;
    for (let i = 1; i < headYs.length; i++) minGap = Math.min(minGap, Math.abs(headYs[i] - headYs[i - 1]));
    $("#layer-heads").classList.toggle("compact", minGap < 118);
    $("#layer-heads").classList.toggle("tiny", minGap < 84);
    drawGrid(f);
    // nodes
    NS_.forEach((s, id) => {
      const E = nodeEls.get(id);
      if (s.r < 0.3 || layerY.get(s.n.type).op < 0.02) { E.g.style.display = "none"; return; }
      E.g.style.display = "";
      const p = proj(s.x, s.z, s.n.type);
      s.sx = p[0]; s.sy = p[1];
      const r = Math.max(1.6, s.r * p[2]);
      s.sr = r;
      const hov = hoverId === id;
      E.c.setAttribute("cx", p[0]); E.c.setAttribute("cy", p[1]); E.c.setAttribute("r", hov ? r + 1.5 : r);
      E.c.setAttribute("fill-opacity", Math.min(1, hov ? 1 : s.op) * layerY.get(s.n.type).op);
      E.c.setAttribute("stroke", hov ? "#fff" : "none");
      E.hit.setAttribute("cx", p[0]); E.hit.setAttribute("cy", p[1]); E.hit.setAttribute("r", Math.max(r + 2, 6));
      if (s.ring > 0.5) {
        E.ring.style.display = "";
        E.ring.setAttribute("cx", p[0]); E.ring.setAttribute("cy", p[1]); E.ring.setAttribute("r", Math.max(r + 4, s.ring * p[2]));
        E.ring.setAttribute("stroke-opacity", Math.min(0.9, s.tring ? 0.9 : s.ring / 20));
        E.ring.setAttribute("stroke", s.hl ? "#8bc5ff" : "#fff");
      } else E.ring.style.display = "none";
    });
    // threads
    threadEls.forEach((e) => {
      const A = NS_.get(e.t.a), Bn = NS_.get(e.t.b);
      if (A.sx == null || Bn.sx == null) return;
      const mx = (A.sx + Bn.sx) / 2, my = (A.sy + Bn.sy) / 2;
      // a gentle bow keeps parallel threads apart
      const bow = e.t.core ? 0 : (Bn.sx - A.sx) * 0.08;
      const d = `M${A.sx.toFixed(1)},${A.sy.toFixed(1)} Q${(mx + bow).toFixed(1)},${(my - Math.abs(bow) * 0.4).toFixed(1)} ${Bn.sx.toFixed(1)},${Bn.sy.toFixed(1)}`;
      e.path.setAttribute("d", d); e.hit.setAttribute("d", d);
      e.path.setAttribute("stroke-opacity", e.hover ? 1 : e.t.core ? 0.85 : e.t.hl ? 0.95 : 0.5);
    });
    drawLabels();
  }

  function drawGrid(f) {
    gGrid.textContent = "";
    const vis = TYPES.filter((t) => f.types.has(t.id) && layerY.get(t.id).op > 0.5);
    if (!vis.length) return;
    const ticks = [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025].filter((y) => y >= f.range[0] && y <= f.range[1]);
    if (!ticks.includes(f.range[0])) ticks.unshift(f.range[0]);
    if (!ticks.includes(f.range[1])) ticks.push(f.range[1]);
    const bottom = vis[vis.length - 1].id;
    let lastX = -Infinity;
    ticks.forEach((y, i) => {
      const X = xOfYear(y, f);
      vis.forEach((t) => {
        const a = proj(X, -B, t.id), b = proj(X, B, t.id);
        el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#fff", "stroke-opacity": 0.045, "stroke-dasharray": "2 4" }, gGrid);
      });
      const a = proj(X, -B, bottom);
      const last = i === ticks.length - 1;
      if (a[0] - lastX > 30 || last) {
        if (last && a[0] - lastX < 30) gGrid.lastChild?.tagName === "text" && gGrid.removeChild(gGrid.lastChild);
        el("line", { x1: a[0], y1: a[1], x2: a[0], y2: a[1] + 5, stroke: "#9aa2b2", "stroke-opacity": 0.6 }, gGrid);
        const tx = el("text", { x: a[0], y: a[1] + 17, class: "grid-label", "text-anchor": "middle" }, gGrid);
        tx.textContent = y;
        lastX = a[0];
      }
    });
    const st = proj(-1, -B, bottom);
    const cap_ = el("text", { x: st[0], y: st[1] + 32, class: "grid-label", "text-anchor": "start" }, gGrid);
    cap_.textContent = "median publication year of the concept's papers →";
  }

  // labels: greedy placement, priority order, skip on collision
  const measure = (() => { const c = document.createElement("canvas").getContext("2d"); return (t, bold) => { c.font = `${bold ? 700 : 500} ${bold ? 13 : 12}px "IBM Plex Sans", sans-serif`; return c.measureText(t).width; }; })();
  function drawLabels() {
    gLabels.textContent = "";
    const chainSet = new Set(model.chain);
    const ids = labelIds.filter((id) => chainSet.has(id)).concat(labelIds.filter((id) => !chainSet.has(id)));
    if (hoverId && !ids.includes(hoverId)) ids.unshift(hoverId);
    const placed = [];
    const W = $("#stage").clientWidth;
    const hitsBox = (b) => placed.some((p) => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
    ids.forEach((id) => {
      const s = NS_.get(id);
      if (!s || s.sx == null || s.r < 0.5 || !s.visible) return;
      const chain = model.chain.includes(id);
      const text = s.n.label;
      const cnt = chain || s.hl ? "" : model.chain.length ? ` ${model.cand.get(id) || 0}` : ` ${s.count}`;
      const w = measure(text, chain) + (cnt ? cnt.length * 6.5 + 4 : 0);
      const h = chain ? 16 : 15;
      const r = s.sr + 4;
      const opts = [
        { x: s.sx + r, y: s.sy - h / 2, anchor: "start" },
        { x: s.sx - r - w, y: s.sy - h / 2, anchor: "end" },
        { x: s.sx - w / 2, y: s.sy - r - h, anchor: "middle" },
        { x: s.sx - w / 2, y: s.sy + r, anchor: "middle" }
      ];
      let spot = opts.find((o) => o.x > 4 && o.x + w < W - 4 && !hitsBox({ x: o.x, y: o.y, w, h }));
      if (!spot && (id === hoverId || chain)) spot = opts[0];
      if (!spot) return;
      placed.push({ x: spot.x, y: spot.y, w, h });
      const tx = spot.anchor === "start" ? spot.x : spot.anchor === "end" ? spot.x + w : spot.x + w / 2;
      const t = el("text", { x: tx, y: spot.y + h - 4, "text-anchor": spot.anchor, class: chain ? "chain" : "", fill: chain ? "#fff" : "#e6e9ef" }, gLabels);
      t.textContent = text;
      if (cnt) { const ts = el("tspan", { class: "cnt" }, t); ts.textContent = cnt; }
    });
  }

  // ---------- Tooltip ----------
  const tip = $("#tip");
  function showTip(e, id) {
    const s = NS_.get(id), n = s.n;
    const inS = model.chain.length && !model.chain.includes(id) ? `<div class="m">${model.cand.get(id) || 0} of the ${plural(model.sample.length, "paper")} in your sample</div>` : "";
    tip.innerHTML = `<div class="t" style="color:${atlas.colorOf(n.type)}">${esc(n.label)}</div><div class="m">${atlas.typeOf(n.type).label} · ${plural(s.count, "paper")} · median ${s.medianYear ?? "—"}</div>${inS}<div class="m">${model.chain.includes(id) ? "In your core sample" : "Click to add to the core sample"}</div>`;
    tip.hidden = false; moveTip(e);
  }
  function showThreadTip(e, t) {
    const a = atlas.byId.get(t.a), b = atlas.byId.get(t.b);
    tip.innerHTML = t.hl
      ? `<div class="t">${esc(a.label)} ↔ ${esc(b.label)}</div><div class="m">click for why they're linked</div>`
      : t.core
      ? `<div class="t">${esc(a.label)} ↔ ${esc(b.label)}</div><div class="m">part of your core sample · click for why they're linked</div>`
      : `<div class="t">${esc(b.label)}</div><div class="m">${plural(t.w, "paper")} in the sample also study it</div><div class="m">click for why it's linked to ${esc(a.label)}</div>`;
    tip.hidden = false; moveTip(e);
  }
  function moveTip(e) {
    const r = $("#stage").getBoundingClientRect();
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + 290 > r.width) x = e.clientX - r.left - 290;
    if (y + 90 > r.height) y = e.clientY - r.top - 90;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- Orbit by dragging (tilted view only) ----------
  let drag = null, dragMoved = false;
  const svg = $("#svg");
  svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; dragMoved = false; });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragMoved && Math.hypot(dx, dy) < 4) return;
    dragMoved = true;
    svg.classList.add("dragging");
    if (view.tilt < 0.5) return;
    view.yaw = Math.max(-0.75, Math.min(0.75, drag.yaw + dx * 0.004));
    view.pitch = Math.max(0.22, Math.min(0.85, drag.pitch + dy * 0.003));
    cur.yaw = view.yaw; cur.pitch = view.pitch;
    fit(false); cur.k = tgt.k; cur.ox = tgt.ox; cur.oy = tgt.oy;
    kick();
  });
  window.addEventListener("pointerup", () => { drag = null; svg.classList.remove("dragging"); setTimeout(() => { dragMoved = false; }, 0); });

  // ---------- Layer headers ----------
  function renderHeads() {
    const m = model;
    TYPES.forEach((t) => {
      const h = headEls.get(t.id);
      const total = atlas.nodes.filter((n) => n.type === t.id && NS_.get(n.id).visible).length;
      let smp = "";
      if (m.chain.length) {
        const inChain = m.chain.find((id) => atlas.byId.get(id).type === t.id);
        if (inChain) smp = `<div class="smp" style="color:${t.color}">◉ in sample</div>`;
        else smp = `<div class="smp" style="color:${t.color}">${(m.byLayer.get(t.id) || []).length} of ${total} in sample</div>`;
      }
      h.innerHTML = `<div class="nm" style="color:${t.color}">${esc(t.plural)} <span class="ct">· ${total}</span></div><div class="q">${cap(QUESTION[t.id] || "")}</div><div class="df">${esc(t.definition)}</div>${smp}`;
    });
  }

  // ---------- Panel ----------
  const panel = $("#panel");
  const dot = (type) => `<span class="dot" style="background:${atlas.colorOf(type)}"></span>`;
  const conceptChip = (n, extra = "", attrs = "") => `<button class="chip" data-add="${esc(n.id)}" ${attrs}>${dot(n.type)}<span class="t">${esc(n.label)}</span>${extra}</button>`;
  const paperRow = (p) => `<button class="paper" data-paper="${p.paper_id}"><div class="pt">${esc(paperTitle(p))}</div><div class="pm">${esc(p.authors || "Unknown authors")} · ${p.year}</div></button>`;
  function paperList(list, limit = 25) {
    if (!list.length) return `<div class="empty">No papers in ${rangeText(state.filter)} match.</div>`;
    const shown = list.slice(0, limit).map(paperRow).join("");
    return shown + (list.length > limit ? `<button class="more" data-more="${limit}">Show all ${list.length}</button>` : "");
  }

  function renderPanel() {
    renderHeads();
    const m = model;
    let html = "";
    if (state.link) html = connectionHTML(state.link[0], state.link[1]);
    else if (state.paper != null) html = paperHTML(state.paper);
    else if (!m.chain.length) html = landingHTML();
    else html = sampleHTML();
    panel.innerHTML = html;
    panel.scrollTop = 0;
    const hint = $("#hint");
    if (!m.chain.length) hint.textContent = "Start a core sample: pick who is studied, or start from any layer.";
    else if (m.sample.length === 0) hint.textContent = "No paper covers this whole sample. See the panel for the nearest studied combination.";
    else if (m.chain.length < m.visTypes.length) hint.textContent = "Pick a lit concept in another layer to drill deeper, or click a thread to see why it's linked.";
    else hint.textContent = "Every layer is in the sample. Open a paper, or remove a step to widen it.";
    if (state.link || state.paper != null) hint.textContent = "";
  }

  function landingHTML() {
    const f = state.filter;
    const total = atlas.papersIn(atlas.papers, f).length;
    const subj = atlas.nodes.filter((n) => n.type === "subject" && NS_.get(n.id).visible).sort((a, b) => NS_.get(b.id).count - NS_.get(a.id).count);
    const others = model.visTypes.filter((t) => t.id !== "subject").map((t) => {
      const top = atlas.nodes.filter((n) => n.type === t.id && NS_.get(n.id).visible).sort((a, b) => NS_.get(b.id).count - NS_.get(a.id).count).slice(0, 4);
      return `<div class="layer-block"><div class="lb-h" style="color:${t.color}">${esc(t.plural)} <small>${QUESTION[t.id]}</small></div><div class="start-grid">${top.map((n) => conceptChip(n, `<span class="n">${NS_.get(n.id).count}</span>`)).join("") || `<span class="muted">None match the filters.</span>`}</div></div>`;
    }).join("");
    return `
      <div class="kicker">Core sample <span class="line"></span></div>
      <h2>Drill through the anatomy of a study</h2>
      <p>Each layer is one part of a study design. Pick a concept in any layer and threads show what the same papers also cover. Each pick narrows the sample to the papers that cover <i>all</i> of your picks.</p>
      <div class="core">
        <div class="total" style="border:0;margin:0;padding:0"><span class="big">${fmt(total)}</span><span class="sub">empirical papers${atlas.rangeActive(f) ? ` from ${rangeText(f)}` : ""} in the sample before you drill</span></div>
      </div>
      ${f.types.has("subject") ? `<h3>Start with who is studied <small>${subj.length}</small></h3>
      <div class="start-grid">${subj.map((n) => conceptChip(n, `<span class="n">${NS_.get(n.id).count}</span>`)).join("") || `<span class="muted">No subjects match the filters.</span>`}</div>` : ""}
      <h3>…or start from any layer</h3>
      ${others}`;
  }

  function sampleHTML() {
    const m = model, f = state.filter;
    const final = m.sample.length;
    const total = atlas.papersIn(atlas.papers, f).length;
    const stepsHTML = m.steps.map((s) => {
      const n = atlas.byId.get(s.id), t = atlas.typeOf(n.type);
      return `<div class="stepr ${s.id === m.focus ? "focus" : ""}">
        <span class="bead" style="color:${t.color};background:${t.color}"></span>
        <div class="lab"><span class="ty">${esc(t.label)} · ${QUESTION[t.id]}</span><button data-focus="${esc(s.id)}" title="Focus on this concept">${esc(n.label)}</button></div>
        <span class="cnt">${fmt(s.count)}</span>
        <button class="x" data-remove="${esc(s.id)}" title="Remove this step" aria-label="Remove ${esc(n.label)}">×</button>
      </div>`;
    }).join("");
    const bars = [{ c: total, l: "all" }].concat(m.steps.map((s) => ({ c: s.count, l: atlas.typeOf(atlas.byId.get(s.id).type).label }))).map((b, i) => {
      const hgt = Math.max(2, Math.round(Math.sqrt(b.c / Math.max(1, total)) * 28));
      const col = i === 0 ? "#4a5061" : atlas.colorOf(atlas.byId.get(m.steps[i - 1].id).type);
      return `<div style="height:${hgt}px;background:${col}" title="${b.l}: ${b.c} papers"><span>${b.c}</span></div>`;
    }).join("");
    let gap = "";
    if (final === 0 && m.chain.length >= 2) {
      const sug = m.suggestions.map((s) => {
        const names = layerOrdered(s.chain).map((id) => esc(atlas.byId.get(id).label)).join(" → ");
        const what = s.kind === "swap" ? `Swap <b>${esc(atlas.byId.get(s.drop).label)}</b> for <b>${esc(atlas.byId.get(s.add).label)}</b>` : `Drop <b>${esc(atlas.byId.get(s.drop).label)}</b>`;
        return `<button class="sugg" data-chain="${esc(s.chain.join(","))}"><span class="n">${plural(s.n, "paper")}</span>${what}<br><span class="muted" style="font-size:11.5px">${names}</span></button>`;
      }).join("");
      gap = `<div class="gapbox"><b>0 papers: a possible research gap.</b>
        <p>No paper in the Atlas${atlas.rangeActive(f) ? ` from ${rangeText(f)}` : ""} studies all of these together. It may be unexplored ground, or it may just be outside this conference's papers.</p>
        ${sug ? `<div class="muted" style="font-size:12px">Nearest combinations that do have papers:</div>${sug}` : ""}</div>`;
    }
    const next = m.visTypes.filter((t) => !m.chainTypes.has(t.id)).map((t) => {
      const list = (m.byLayer.get(t.id) || []).slice(0, 5);
      const anchor = m.anchorFor(t.id);
      const mx = Math.max(1, ...list.map((c) => c.count));
      return `<div class="layer-block"><div class="lb-h" style="color:${t.color}">${esc(t.plural)} <small>${QUESTION[t.id]}</small></div>
        ${list.map((c) => `<div class="row" data-add="${esc(c.node.id)}" role="button" tabindex="0"><span class="t">${dot(t.id)}<span>${esc(c.node.label)}</span></span>
          <span class="n" style="color:${t.color}"><span class="bar" style="width:${Math.round(40 * c.count / mx)}px"></span><span style="color:var(--muted)">${c.count}</span><button class="why" data-link="${esc(anchor)}~${esc(c.node.id)}" title="Why is this linked?">why</button></span></div>`).join("") || `<div class="muted" style="font-size:12.5px;padding:4px 8px">${final ? "None of these papers cover this layer." : "—"}</div>`}
      </div>`;
    }).join("");
    // focus concept: same-layer partners (e.g. construct + construct)
    const fn = atlas.byId.get(m.focus), fs = NS_.get(m.focus);
    const same = atlas.neighbors(m.focus, f).filter((x) => x.node.type === fn.type).slice(0, 6);
    const spark = sparkSVG(fn.yearCounts, atlas.colorOf(fn.type));
    return `
      <div class="kicker">Core sample <span class="line"></span></div>
      <div class="core ${final === 0 ? "gap" : ""}">
        <div class="steps">${stepsHTML}</div>
        <div class="shrink">${bars}</div>
        <div class="total"><span class="big" style="color:${final ? "var(--text)" : "var(--gap)"}">${fmt(final)}</span><span class="sub">${final === 1 ? "paper covers" : "papers cover"} every step${atlas.rangeActive(f) ? ` (${rangeText(f)})` : ""}</span></div>
        ${gap}
      </div>
      ${m.chain.length < m.visTypes.length && final ? `<h3>Most common next steps <small>within these ${fmt(final)} papers</small></h3>${next}` : ""}
      ${final ? `<h3>Papers in the sample <small>${final}</small></h3><div id="plist">${paperList(m.sample)}</div>` : ""}
      <h3>Focus: ${esc(fn.label)}</h3>
      <p style="font-size:13px">${esc(fn.description || atlas.typeOf(fn.type).definition)}</p>
      <div class="muted" style="font:11px var(--mono)">${plural(fs.count, "paper")} · first in ${fn.firstYear} · median ${fs.medianYear}</div>
      ${spark}
      ${same.length ? `<div class="layer-block"><div class="lb-h" style="color:${atlas.colorOf(fn.type)}">Other ${esc(atlas.typeOf(fn.type).plural.toLowerCase())} studied with it <small>same layer</small></div>
        ${same.map((x) => `<button class="row" data-link="${esc(m.focus)}~${esc(x.node.id)}"><span class="t">${dot(x.node.type)}<span>${esc(x.node.label)}</span></span><span class="n">${x.shared} <span class="why">why</span></span></button>`).join("")}</div>` : ""}
    `;
  }

  function sparkSVG(counts, color, range = state.filter.range) {
    const W = 340, H = 40, n = counts.length, mx = Math.max(1, ...counts);
    const bw = W / n;
    const bars = counts.map((c, i) => {
      const y = atlas.Y0 + i, inR = y >= range[0] && y <= range[1];
      const h = c ? Math.max(2, (c / mx) * (H - 12)) : 0;
      return h ? `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(H - 10 - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" opacity="${inR ? 0.85 : 0.2}"><title>${y}: ${c}</title></rect>` : "";
    }).join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<line x1="0" x2="${W}" y1="${H - 10}" y2="${H - 10}" stroke="#2b3040"/><text x="0" y="${H}" class="grid-label">${atlas.Y0}</text><text x="${W}" y="${H}" text-anchor="end" class="grid-label">${atlas.Y1}</text></svg>`;
  }

  function backLabel() { return state.chain.length ? "← Back to the core sample" : "← Back to the layers"; }

  // The graph export leaves two catch-all concepts ("no design object", "multi-phase design process")
  // without edges, so explainConnection reports 0 for them. Strata works from the papers directly, so
  // when there is no edge the same facts are computed from the shared paper list.
  function explain(aId, bId, f) {
    const ex = atlas.explainConnection(aId, bId, f);
    if (ex.link) return ex;
    const shared = atlas.papersWithAll([aId, bId], f).slice().sort((p, q) => q.year - p.year);
    const n = shared.length;
    if (!n) return ex;
    const counts = new Map();
    shared.forEach((p) => atlas.conceptsOfPaper(p.paper_id).forEach((c) => { if (c.id !== aId && c.id !== bId) counts.set(c.id, (counts.get(c.id) || 0) + 1); }));
    const alongside = [...counts].sort((x, y) => y[1] - x[1]).map(([id, count]) => ({ node: atlas.byId.get(id), count }));
    const ys = shared.map((p) => p.year), minY = Math.min(...ys), maxY = Math.max(...ys);
    let trend;
    if (minY === maxY) trend = `All ${plural(n, "paper")} were published in ${minY}.`;
    else {
      const mid = Math.floor((minY + maxY) / 2), early = ys.filter((y) => y <= mid).length, late = n - early;
      const shape = late >= early * 1.5 ? "Growing over time" : early >= late * 1.5 ? "Mostly older work" : "Spread fairly evenly over time";
      trend = `${shape}: ${early} from ${minY}–${mid}, ${late} from ${mid + 1}–${maxY}.`;
    }
    const ca = atlas.countOf(ex.a, f), cb = atlas.countOf(ex.b, f);
    const expected = (ca * cb) / Math.max(1, atlas.papersIn(atlas.papers, f).length);
    return { ...ex, papers: shared, n, sentence: atlas.connectionSentence(ex.a, ex.b, n), shareOfA: ca ? n / ca : 0, shareOfB: cb ? n / cb : 0,
      lift: expected ? n / expected : 0, alongside, trend, earliest: shared[n - 1], latest: shared[0], derived: true };
  }

  function connectionHTML(aId, bId) {
    const f = state.filter;
    const ex = explain(aId, bId, f);
    const a = ex.a, b = ex.b;
    const liftTxt = ex.n === 0 ? "" : ex.lift >= 1.15
      ? `Studied together about <b>${ex.lift.toFixed(1)}×</b> as often as you'd expect if the two were unrelated.`
      : ex.lift <= 0.87 ? `Studied together <b>less often</b> than chance would predict (${ex.lift.toFixed(1)}×): they mostly appear apart.`
      : `Studied together about as often as chance would predict (${ex.lift.toFixed(1)}×).`;
    const liftW = Math.min(100, (ex.lift / 6) * 100);
    const years = new Array(atlas.Y1 - atlas.Y0 + 1).fill(0);
    ex.papers.forEach((p) => { years[p.year - atlas.Y0] += 1; });
    const inSample = model.chain.length && (model.chain.includes(aId) || model.chain.includes(bId)) ? (() => {
      const k = atlas.papersWithAll([...new Set(model.chain.concat([aId, bId]))], f).length;
      return `<p class="muted" style="font-size:12.5px">${plural(k, "paper")} of these also fit your whole core sample.</p>`;
    })() : "";
    const along = ex.alongside.slice(0, 8);
    const amx = Math.max(1, ...along.map((x) => x.count));
    return `
      <button class="back" data-back>${backLabel()}</button>
      <div class="kicker">Connection <span class="line"></span></div>
      <h2 style="font-size:17px">${dot(a.type)} ${esc(a.label)}<br><span class="muted" style="font-size:13px">and</span> ${dot(b.type)} ${esc(b.label)}</h2>
      <p class="sentence">${esc(cap(ex.sentence))}.</p>
      ${ex.n === 0 ? `<div class="empty">No shared papers in ${rangeText(f)}. Widen the year range to see this link.</div>` : `
      <div class="stat-row">
        <div class="stat"><div class="v">${ex.n}</div><div class="k">shared papers</div></div>
        <div class="stat"><div class="v">${Math.round(ex.shareOfA * 100)}%</div><div class="k">of ${esc(a.label)}'s papers</div></div>
        <div class="stat"><div class="v">${Math.round(ex.shareOfB * 100)}%</div><div class="k">of ${esc(b.label)}'s papers</div></div>
      </div>
      <h3>How strong, compared to chance</h3>
      <div class="liftbar"><div style="width:${liftW}%;background:${atlas.colorOf(b.type)}"></div><i style="left:${100 / 6}%" title="chance"></i></div>
      <p style="font-size:13px">${liftTxt}</p>
      ${inSample}
      ${ex.derived ? `<p class="muted" style="font-size:12px">The Atlas graph leaves catch-all concepts like this unlinked, so these numbers are counted straight from the papers.</p>` : ""}
      <h3>Over time</h3>
      <p style="font-size:13px">${esc(ex.trend)}</p>
      ${sparkSVG(years, "#8bc5ff")}
      ${along.length ? `<h3>What else these papers study</h3>
        ${along.map((x) => `<button class="row" data-add="${esc(x.node.id)}"><span class="t">${dot(x.node.type)}<span>${esc(x.node.label)}</span></span><span class="n" style="color:${atlas.colorOf(x.node.type)}"><span class="bar" style="width:${Math.round(40 * x.count / amx)}px"></span><span style="color:var(--muted)">${x.count}</span></span></button>`).join("")}` : ""}
      <div class="btn-row"><button class="btn" data-chain="${esc(a.type === b.type ? bId : [...new Set(state.chain.filter((c) => ![a.type, b.type].includes(atlas.byId.get(c).type)).concat([aId, bId]))].join(","))}">${a.type === b.type ? "Drill from " + esc(b.label) : "Add both to the core sample"}</button></div>
      <h3>Shared papers <small>${ex.n}</small></h3>
      <div id="plist">${paperList(ex.papers)}</div>`}`;
  }

  function paperHTML(pid) {
    const p = atlas.paperById.get(pid);
    const cs = atlas.conceptsOfPaper(pid);
    const bands = TYPES.map((t) => {
      const list = cs.filter((n) => n.type === t.id);
      return `<div class="band"><div class="bn" style="color:${t.color}">${esc(t.plural)}</div><div class="bc">${list.map((n) => conceptChip(n, "", `title="Start a core sample at ${esc(n.label)}" data-solo="1"`)).join("") || `<span class="none">not recorded</span>`}</div></div>`;
    }).join("");
    const rel = atlas.relatedPapers(pid, 5);
    const coreIds = TYPES.map((t) => cs.find((n) => n.type === t.id)).filter(Boolean).map((n) => n.id);
    const inChain = model.chain.length ? `<p class="muted" style="font-size:12.5px">This paper is ${model.sample.some((x) => x.paper_id === pid) ? "" : "not "}in your current core sample.</p>` : "";
    return `
      <button class="back" data-back>${backLabel()}</button>
      <div class="kicker">Paper · ${p.year} <span class="line"></span></div>
      <h2 style="font-size:18px">${esc(paperTitle(p))}</h2>
      <p class="muted" style="font-size:13px">${esc(p.authors || "Unknown authors")} · ASME DTM ${p.year}</p>
      ${inChain}
      <h3>Its core <small>what this study looked at, layer by layer</small></h3>
      <div class="mini-core"><div class="shaft"></div>${bands}</div>
      <div class="btn-row">
        <button class="btn" data-chain="${esc(coreIds.join(","))}">Use this paper as a core sample</button>
        <a class="btn" href="${atlas.paperLink(p)}" target="_blank" rel="noopener">Find on Google Scholar ↗</a>
      </div>
      <h3>Related papers <small>most concepts in common</small></h3>
      ${rel.map((r) => `<button class="paper" data-paper="${r.paper.paper_id}"><div class="pt">${esc(paperTitle(r.paper))}</div><div class="pm">${esc(r.paper.authors || "")} · ${r.paper.year} · shares ${r.shared.length}: ${esc(r.shared.slice(0, 3).map((n) => n.label).join(", "))}${r.shared.length > 3 ? "…" : ""}</div></button>`).join("") || `<div class="empty">No related papers.</div>`}`;
  }

  panel.addEventListener("click", (e) => {
    const t = e.target.closest("[data-link],[data-add],[data-remove],[data-focus],[data-paper],[data-back],[data-chain],[data-more]");
    if (!t) return;
    e.stopPropagation();
    if (t.dataset.link) { const [a, b] = t.dataset.link.split("~"); go({ link: [a, b], paper: null }); }
    else if (t.dataset.remove) removeFromChain(t.dataset.remove);
    else if (t.dataset.focus) go({ chain: state.chain.filter((c) => c !== t.dataset.focus).concat(t.dataset.focus), link: null, paper: null });
    else if (t.dataset.paper) go({ paper: Number(t.dataset.paper), link: null });
    else if (t.dataset.back != null) go({ link: null, paper: null });
    else if (t.dataset.chain != null) go({ chain: t.dataset.chain.split(",").filter(Boolean), link: null, paper: null });
    else if (t.dataset.more) {
      const list = state.link ? explain(state.link[0], state.link[1], state.filter).papers : model.sample;
      $("#plist").innerHTML = list.map(paperRow).join("");
    } else if (t.dataset.add) {
      if (t.dataset.solo) go({ chain: [t.dataset.add], link: null, paper: null });
      else addToChain(t.dataset.add);
    }
  });
  panel.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".row[data-add]")) addToChain(e.target.dataset.add); });

  // ---------- Breadcrumb ----------
  function renderCrumbs() {
    const c = $("#crumbs");
    let h = `<button class="home" data-crumb="home">All layers</button>`;
    model.ordered.forEach((id) => {
      const n = atlas.byId.get(id);
      h += `<span class="sep">›</span><button data-crumb="${esc(id)}" title="${esc(atlas.typeOf(n.type).label)}: ${esc(n.label)}">${dot(n.type)}${esc(n.label)}</button>`;
    });
    if (model.chain.length) h += `<span class="sep">=</span><span style="color:${model.sample.length ? "var(--text)" : "var(--gap)"}">${plural(model.sample.length, "paper")}</span>`;
    if (state.link) h += `<span class="sep">›</span><button class="tail" data-crumb="back">connection</button>`;
    if (state.paper != null) h += `<span class="sep">›</span><button class="tail" data-crumb="back">paper</button>`;
    c.innerHTML = h;
    c.classList.toggle("long", model.ordered.length >= 3 || (model.ordered.length >= 2 && (state.link || state.paper != null)));
  }
  $("#crumbs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-crumb]");
    if (!b) return;
    const k = b.dataset.crumb;
    if (k === "home") go({ chain: [], link: null, paper: null });
    else if (k === "back") return;
    else go({ chain: state.chain.filter((c) => c !== k).concat(k), link: null, paper: null });
  });

  // ---------- Controls ----------
  const lt = $("#layer-toggles");
  lt.innerHTML = `<span class="tlabel">Layers</span>` + TYPES.map((t) => `<button class="ltog" data-type="${t.id}" title="Show or hide the ${t.plural.toLowerCase()} layer">${dot(t.id)}${esc(t.plural)}</button>`).join("");
  lt.addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    const f = { ...state.filter, types: new Set(state.filter.types) };
    if (f.types.has(b.dataset.type)) { if (f.types.size > 1) f.types.delete(b.dataset.type); } else f.types.add(b.dataset.type);
    go({ filter: f }, true);
  });
  const y0 = $("#y0"), y1 = $("#y1");
  [y0, y1].forEach((i) => { i.min = atlas.Y0; i.max = atlas.Y1; i.step = 1; });
  let yTimer = 0;
  function onYears(e) {
    let a = +y0.value, b = +y1.value;
    if (a > b) { if (e.target === y0) a = b; else b = a; y0.value = a; y1.value = b; }
    $("#y0v").textContent = a; $("#y1v").textContent = b; paintDual();
    clearTimeout(yTimer);
    yTimer = setTimeout(() => go({ filter: { ...state.filter, range: [a, b] } }, true), 120);
  }
  y0.addEventListener("input", onYears); y1.addEventListener("input", onYears);
  function paintDual() {
    const span = atlas.Y1 - atlas.Y0;
    $("#dual-fill").style.left = `${((y0.value - atlas.Y0) / span) * 100}%`;
    $("#dual-fill").style.right = `${((atlas.Y1 - y1.value) / span) * 100}%`;
  }
  $("#m-dn").addEventListener("click", () => go({ filter: { ...state.filter, minPapers: Math.max(1, state.filter.minPapers - (state.filter.minPapers > 5 ? 5 : 1)) } }, true));
  $("#m-up").addEventListener("click", () => go({ filter: { ...state.filter, minPapers: Math.min(50, state.filter.minPapers + (state.filter.minPapers >= 5 ? 5 : 1)) } }, true));
  $("#v-tilt").addEventListener("click", () => go({ flat: false }, true));
  $("#v-flat").addEventListener("click", () => go({ flat: true }, true));
  function renderControls() {
    const f = state.filter;
    lt.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("off", !f.types.has(b.dataset.type)));
    if (document.activeElement !== y0 && document.activeElement !== y1) { y0.value = f.range[0]; y1.value = f.range[1]; }
    $("#y0v").textContent = y0.value; $("#y1v").textContent = y1.value; paintDual();
    $("#mval").textContent = f.minPapers;
    $("#v-tilt").classList.toggle("on", !state.flat);
    $("#v-flat").classList.toggle("on", state.flat);
  }
  $("#reset").addEventListener("click", () => { view.yaw = -0.3; view.pitch = 0.4; location.hash = "#/"; });
  $("#brand").addEventListener("click", () => go({ chain: [], link: null, paper: null }));
  $("#about-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#about").hidden = !$("#about").hidden; $("#about-btn").classList.toggle("on", !$("#about").hidden); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#about")) { $("#about").hidden = true; $("#about-btn").classList.remove("on"); } });

  // ---------- Legend: open on the landing view, tucked away while drilling unless pinned ----------
  let legendPinned = null;
  function renderLegend() {
    const open = legendPinned ?? !model.chain.length;
    $("#legend").classList.toggle("closed", !open);
    $("#legend-tog").textContent = open ? "Hide" : "How to read ▸";
  }
  $("#legend-tog").addEventListener("click", () => { legendPinned = $("#legend").classList.contains("closed"); renderLegend(); });

  // ---------- Search ----------
  const sIn = $("#search"), sOut = $("#search-results");
  let sRes = [], sSel = 0;
  function renderSearch() {
    const q = sIn.value.trim();
    if (!q) { sOut.hidden = true; return; }
    sRes = atlas.search(q, 8, { ...state.filter, types: null });
    sOut.innerHTML = sRes.length ? sRes.map((n, i) => `<div class="sr ${i === sSel ? "on" : ""}" data-i="${i}" role="option">${dot(n.type)}<span class="t">${esc(n.label)}</span><span class="m">${atlas.typeOf(n.type).label.toLowerCase()} · ${atlas.countOf(n, state.filter)}</span></div>`).join("")
      : `<div class="sr-empty">No concept matches “${esc(q)}”${atlas.rangeActive(state.filter) ? ` in ${rangeText(state.filter)}` : ""}.</div>`;
    sOut.hidden = false;
  }
  function pickSearch(n) {
    sIn.value = ""; sOut.hidden = true; sIn.blur();
    const f = { ...state.filter, types: new Set(state.filter.types) };
    f.types.add(n.type);
    if (atlas.countOf(n, f) < f.minPapers) f.minPapers = 1;
    state.filter = f;
    addToChain(n.id);
  }
  sIn.addEventListener("input", () => { sSel = 0; renderSearch(); });
  sIn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sSel = Math.min(sRes.length - 1, sSel + 1); renderSearch(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sSel = Math.max(0, sSel - 1); renderSearch(); e.preventDefault(); }
    else if (e.key === "Enter" && sRes[sSel]) pickSearch(sRes[sSel]);
    else if (e.key === "Escape") { sIn.value = ""; sOut.hidden = true; sIn.blur(); e.stopPropagation(); }
  });
  sOut.addEventListener("mousedown", (e) => { const r = e.target.closest("[data-i]"); if (r) { e.preventDefault(); pickSearch(sRes[+r.dataset.i]); } });
  sIn.addEventListener("blur", () => setTimeout(() => { sOut.hidden = true; }, 150));

  // ---------- Keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) return;
    if (e.key === "/") { e.preventDefault(); sIn.focus(); }
    if (e.key === "Escape") {
      if (!$("#about").hidden) { $("#about").hidden = true; return; }
      if (state.link || state.paper != null) go({ link: null, paper: null });
      else if (state.chain.length) go({ chain: state.chain.slice(0, -1) });
    }
  });

  window.addEventListener("resize", () => { fit(true); kick(); });
  if (!location.hash) history.replaceState(null, "", "#/");
  route();
  // first frame: start from the fitted spot so the stack settles in instead of flying across
  cur.k = tgt.k * 0.9; cur.ox = tgt.ox; cur.oy = tgt.oy;
  kick();
})();
