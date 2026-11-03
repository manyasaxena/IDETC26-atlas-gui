// Atlas · Star Systems (2.5D). Galaxy of neighborhoods -> system -> concept -> connection -> paper.
// Flat SVG with depth cues (tilted orbits, depth ordering and scaling, starfield parallax) so labels stay readable.
(async function () {
  "use strict";
  const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DUR = RM ? 0 : 950;
  const TILT_G = 0.7;   // galaxy plane tilt (vertical squash)
  const TILT_S = 0.62;  // orbit plane tilt inside a system
  const MOON_MAX = 12;

  let atlas;
  try {
    atlas = await AtlasCore.load();
  } catch (e) {
    document.getElementById("loading").textContent = e.message;
    return;
  }
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* fonts optional */ }

  const T = atlas.text;
  const esc = T.esc;
  const $ = (s) => document.querySelector(s);
  const svg = d3.select("#scene");
  const gGal = d3.select("#g-galaxy");
  const gSys = d3.select("#g-system");
  const gFocus = d3.select("#g-focus");
  const tip = $("#tip");

  const SYS = atlas.clusters.filter((c) => !c.unlinked);
  const DEBRIS = atlas.clusters.find((c) => c.unlinked) || null;
  const STAR_COLORS = ["#fff0c9", "#cfe0ff", "#ffd7a3", "#e6dcff", "#fff8e8", "#c8f0ff", "#ffe3c9", "#d9e8ff", "#ffcfb0", "#f2f5ff", "#ffeab0", "#d6f5e8", "#ffd0dc", "#e0e6ff"];
  SYS.forEach((s, i) => { s.color = STAR_COLORS[i % STAR_COLORS.length]; s.idx = i; });
  if (DEBRIS) DEBRIS.color = "#8a8f9c";

  let F = atlas.defaultFilter();
  const typeLabel = (id) => atlas.typeOf(id)?.label || id;
  const shortName = (s, n = 30) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  const sysName = (c) => (c.unlinked ? "Drifting debris" : T.cap(c.name));
  const rangeText = () => `${F.range[0]}–${F.range[1]}`;
  function filterDesc() {
    const parts = [];
    if (atlas.rangeActive(F)) parts.push(rangeText());
    if (F.minPapers > 1) parts.push(`≥ ${F.minPapers} papers`);
    if (F.types.size < atlas.types.length) parts.push(atlas.types.filter((t) => F.types.has(t.id)).map((t) => t.plural.toLowerCase()).join(", ") || "no types");
    return parts.join(", ");
  }

  // ---------- Text measurement ----------
  const mctx = document.createElement("canvas").getContext("2d");
  function tw(str, size = 12, weight = 400, mono = false) {
    mctx.font = `${weight} ${size}px ${mono ? '"IBM Plex Mono"' : '"IBM Plex Sans"'}, sans-serif`;
    return mctx.measureText(str).width;
  }

  // ---------- Seeded random ----------
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Galaxy layout: systems sharing more papers sit closer ----------
  const n = SYS.length;
  const simM = SYS.map(() => new Array(n).fill(0));
  const sharedAll = SYS.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let c = 0;
    SYS[i].paperIds.forEach((p) => { if (SYS[j].paperIds.has(p)) c++; });
    sharedAll[i][j] = sharedAll[j][i] = c;
    simM[i][j] = simM[j][i] = c / Math.sqrt(SYS[i].paperCount * SYS[j].paperCount);
  }
  (function layoutGalaxy() {
    const maxSim = d3.max(simM.flat()) || 1;
    const nodes = SYS.map((s, i) => ({ i, x: 260 * Math.cos((2 * Math.PI * i) / n), y: 260 * Math.sin((2 * Math.PI * i) / n) }));
    const links = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) links.push({ source: i, target: j, s: simM[i][j] / maxSim });
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).distance((l) => 70 + (1 - l.s) * 430).strength((l) => 0.04 + Math.pow(l.s, 1.4) * 0.9))
      .force("charge", d3.forceManyBody().strength(-160))
      .force("collide", d3.forceCollide(92))
      .force("x", d3.forceX(0).strength(0.02))
      .force("y", d3.forceY(0).strength(0.02))
      .stop();
    for (let k = 0; k < 600; k++) sim.tick();
    // Rotate so the long axis runs horizontally (screens are wide).
    const mx = d3.mean(nodes, (d) => d.x), my = d3.mean(nodes, (d) => d.y);
    let cxx = 0, cyy = 0, cxy = 0;
    nodes.forEach((d) => { const x = d.x - mx, y = d.y - my; cxx += x * x; cyy += y * y; cxy += x * y; });
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    nodes.forEach((d) => {
      const x = d.x - mx, y = d.y - my;
      SYS[d.i].u = x * Math.cos(-ang) - y * Math.sin(-ang);
      SYS[d.i].v = x * Math.sin(-ang) + y * Math.cos(-ang);
    });
  })();

  // ---------- Filtered statistics ----------
  let ST = null;
  function computeStats() {
    const sys = SYS.map((s) => {
      const vis = s.members.filter((m) => atlas.nodeVisible(m, F));
      const set = new Set(vis.flatMap((m) => atlas.papersIn(m.papers, F).map((p) => p.paper_id)));
      return { vis, set, count: set.size };
    });
    const shared = SYS.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const [a, b] = sys[i].set.size < sys[j].set.size ? [sys[i].set, sys[j].set] : [sys[j].set, sys[i].set];
      let c = 0; a.forEach((p) => { if (b.has(p)) c++; });
      shared[i][j] = shared[j][i] = c;
    }
    const debVis = DEBRIS ? DEBRIS.members.filter((m) => atlas.nodeVisible(m, F)) : [];
    ST = { sys, shared, debVis, papersInRange: atlas.papersIn(atlas.papers, F).length };
  }
  computeStats();

  // ---------- Geometry ----------
  let W, H, PW, G = {};
  function geom() {
    W = window.innerWidth; H = window.innerHeight;
    PW = Math.round(Math.min(390, Math.max(310, W * 0.27)));
    document.documentElement.style.setProperty("--panel-w", PW + "px");
    const area = { x0: 14, x1: W - PW - 30, y0: 66, y1: H - 62 };
    area.w = area.x1 - area.x0; area.h = area.y1 - area.y0;
    area.cx = (area.x0 + area.x1) / 2; area.cy = (area.y0 + area.y1) / 2;
    G.area = area;
    // Galaxy fit
    const gx0 = 70, gx1 = W - 70, gy0 = 128, gy1 = H - 120;
    const maxU = d3.max(SYS, (s) => Math.abs(s.u)) || 1, maxV = d3.max(SYS, (s) => Math.abs(s.v)) || 1;
    // Height usually limits the fit; the horizontal axis may stretch up to 1.3x to use wide screens.
    const kv = Math.min((gy1 - gy0 - 70) / 2 / (maxV * TILT_G), (gx1 - gx0 - 260) / 2 / maxU);
    const k = Math.min((gx1 - gx0 - 260) / 2 / maxU, kv * 1.3);
    G.k = k; G.kv = kv; G.gcx = (gx0 + gx1) / 2; G.gcy = (gy0 + gy1) / 2; G.maxU = maxU; G.maxV = maxV;
    SYS.forEach((s) => {
      s.gx = G.gcx + s.u * k;
      s.gy = G.gcy + s.v * kv * TILT_G;
      s.depth = s.v / maxV; // -1 far .. 1 near
    });
    if (DEBRIS) { DEBRIS.gx = W - 190; DEBRIS.gy = H - 118; DEBRIS.depth = 1; }
    sky.width = W * devicePixelRatio; sky.height = H * devicePixelRatio;
  }

  // ---------- Defs (gradients) ----------
  function buildDefs() {
    const defs = d3.select("#defs");
    defs.selectAll("*").remove();
    [...SYS, DEBRIS].filter(Boolean).forEach((s) => {
      const glow = defs.append("radialGradient").attr("id", `glow-${s.id}`);
      glow.append("stop").attr("offset", "0%").attr("stop-color", s.color).attr("stop-opacity", 0.55);
      glow.append("stop").attr("offset", "30%").attr("stop-color", s.color).attr("stop-opacity", 0.16);
      glow.append("stop").attr("offset", "100%").attr("stop-color", s.color).attr("stop-opacity", 0);
      const core = defs.append("radialGradient").attr("id", `core-${s.id}`).attr("cx", "42%").attr("cy", "40%");
      core.append("stop").attr("offset", "0%").attr("stop-color", "#ffffff");
      core.append("stop").attr("offset", "55%").attr("stop-color", s.color);
      core.append("stop").attr("offset", "100%").attr("stop-color", d3.color(s.color).darker(0.6));
    });
    atlas.types.forEach((t) => {
      const g = defs.append("radialGradient").attr("id", `pl-${t.id}`).attr("cx", "35%").attr("cy", "32%").attr("r", "70%");
      g.append("stop").attr("offset", "0%").attr("stop-color", d3.color(t.color).brighter(0.9));
      g.append("stop").attr("offset", "55%").attr("stop-color", t.color);
      g.append("stop").attr("offset", "100%").attr("stop-color", d3.color(t.color).darker(1.6));
      const h = defs.append("radialGradient").attr("id", `halo-${t.id}`);
      h.append("stop").attr("offset", "40%").attr("stop-color", t.color).attr("stop-opacity", 0.35);
      h.append("stop").attr("offset", "100%").attr("stop-color", t.color).attr("stop-opacity", 0);
    });
    const pg = defs.append("radialGradient").attr("id", "probe-glow");
    pg.append("stop").attr("offset", "0%").attr("stop-color", "#ffe9b0").attr("stop-opacity", 0.7);
    pg.append("stop").attr("offset", "100%").attr("stop-color", "#ffe9b0").attr("stop-opacity", 0);
  }

  // ---------- Label placement (greedy, collision-avoiding) ----------
  function overlapArea(a, b) {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y;
  }
  function placeLabels(items, circles, bounds, order, boxes = []) {
    const placed = boxes.slice();
    const ord = order || ["right", "left", "below", "above", "tr", "br", "tl", "bl"];
    items.forEach((it) => {
      const { x, y, r, w, h } = it;
      let best = null;
      [4, 16, 32, 52].forEach((d, di) => {
        ord.forEach((pos, pi) => {
          const k = 0.72;
          let bx, by, anchor;
          if (pos === "right") { bx = x + r + d; by = y - h / 2; anchor = "start"; }
          else if (pos === "left") { bx = x - r - d - w; by = y - h / 2; anchor = "end"; }
          else if (pos === "below") { bx = x - w / 2; by = y + r + d - 1; anchor = "middle"; }
          else if (pos === "above") { bx = x - w / 2; by = y - r - d - h + 1; anchor = "middle"; }
          else if (pos === "tr") { bx = x + r * k + d * k; by = y - r * k - d * k - h + 4; anchor = "start"; }
          else if (pos === "br") { bx = x + r * k + d * k; by = y + r * k + d * k - 4; anchor = "start"; }
          else if (pos === "tl") { bx = x - r * k - d * k - w; by = y - r * k - d * k - h + 4; anchor = "end"; }
          else { bx = x - r * k - d * k - w; by = y + r * k + d * k - 4; anchor = "end"; }
          const box = { x: bx, y: by, w, h };
          let cost = d * 2.2 + pi * 1.5 + di * 6;
          placed.forEach((p) => { cost += overlapArea(box, p) * 4; });
          circles.forEach((c) => {
            if (c === it.self) return;
            const cx = Math.max(box.x, Math.min(c.x, box.x + box.w)), cy = Math.max(box.y, Math.min(c.y, box.y + box.h));
            const dd = Math.hypot(c.x - cx, c.y - cy);
            if (dd < c.r + 2) cost += (c.r + 2 - dd) * (c.r + 2) * 8 + 40;
          });
          const out = Math.max(0, bounds.x0 - box.x) + Math.max(0, box.x + box.w - bounds.x1) + Math.max(0, bounds.y0 - box.y) + Math.max(0, box.y + box.h - bounds.y1);
          cost += out * 60;
          if (!best || cost < best.cost) best = { ...box, anchor, cost, d };
        });
      });
      it.box = best;
      placed.push({ x: best.x - 2, y: best.y - 1, w: best.w + 4, h: best.h + 2 });
    });
    return items;
  }
  // Draws a placed multi-line label. lines: [{text, size, weight, mono, fill, cls}]
  function drawLabel(g, it, lines, cls = "plabel") {
    const b = it.box;
    const tx = b.anchor === "start" ? b.x : b.anchor === "end" ? b.x + b.w : b.x + b.w / 2;
    const lg = g.append("g").attr("class", cls).attr("data-id", it.id || null);
    if (b.d > 10) {
      const cx = Math.max(b.x, Math.min(it.x, b.x + b.w)), cy = Math.max(b.y, Math.min(it.y, b.y + b.h));
      const dx = cx - it.x, dy = cy - it.y, dist = Math.hypot(dx, dy) || 1;
      lg.append("path").attr("class", "leader").attr("d", `M${it.x + (dx / dist) * (it.r + 2)},${it.y + (dy / dist) * (it.r + 2)}L${cx},${cy}`);
    }
    let yy = b.y;
    lines.forEach((ln) => {
      const lh = ln.size * 1.28;
      yy += lh;
      lg.append("text").attr("x", tx).attr("y", yy - lh * 0.24).attr("text-anchor", b.anchor)
        .attr("class", ln.mono ? "mono" : null)
        .style("font-size", ln.size + "px").style("font-weight", ln.weight || 400).style("fill", ln.fill || null)
        .text(ln.text);
    });
    return lg;
  }
  const linesSize = (lines) => ({ w: d3.max(lines, (l) => tw(l.text, l.size, l.weight || 400, l.mono)) + 2, h: d3.sum(lines, (l) => l.size * 1.28) });

  // ---------- Tooltip ----------
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    moveTip(ev);
  }
  function moveTip(ev) {
    if (tip.hidden) return;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 16, y = ev.clientY + 14;
    if (x + r.width > W - 8) x = ev.clientX - r.width - 16;
    if (y + r.height > H - 8) y = ev.clientY - r.height - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  // =====================================================================
  // GALAXY
  // =====================================================================
  const starR = (count, depth = 0) => (count ? (7 + Math.sqrt(count) * 0.95) : 4) * (1 + 0.12 * depth);
  function buildGalaxy() {
    gGal.selectAll("*").remove();
    const par = gGal.append("g").attr("class", "par");
    // Tilted disc rings: a reminder that this is a plane seen at an angle.
    const disc = par.append("g");
    [0.38, 0.72, 1.08].forEach((f) => {
      disc.append("ellipse").attr("class", "disc").attr("cx", G.gcx).attr("cy", G.gcy).attr("rx", G.maxU * G.k * f + 40).attr("ry", (G.maxV * G.kv * f + 40) * TILT_G);
    });

    // Trade routes: each system's strongest link plus the strongest overall.
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (ST.shared[i][j] > 0) {
      const c = ST.shared[i][j];
      pairs.push({ i, j, c, s: c / Math.sqrt(Math.max(1, ST.sys[i].count * ST.sys[j].count)) });
    }
    pairs.sort((a, b) => b.s - a.s);
    const keep = new Set(pairs.slice(0, 12).map((p) => `${p.i}-${p.j}`));
    for (let i = 0; i < n; i++) {
      const best = pairs.find((p) => p.i === i || p.j === i);
      if (best) keep.add(`${best.i}-${best.j}`);
    }
    const routes = pairs.filter((p) => keep.has(`${p.i}-${p.j}`));
    const maxS = d3.max(routes, (p) => p.s) || 1;
    const maxC = d3.max(routes, (p) => p.c) || 1;
    G.routes = routes;
    par.append("g").selectAll("path").data(routes).join("path")
      .attr("class", "route")
      .attr("data-a", (d) => d.i).attr("data-b", (d) => d.j)
      .attr("d", (d) => {
        const a = SYS[d.i], b = SYS[d.j];
        const mx = (a.gx + b.gx) / 2, my = (a.gy + b.gy) / 2;
        const dx = b.gx - a.gx, dy = b.gy - a.gy;
        return `M${a.gx},${a.gy}Q${mx - dy * 0.12},${my + dx * 0.12} ${b.gx},${b.gy}`;
      })
      .attr("stroke-width", (d) => 0.6 + 3.2 * Math.sqrt(d.c / maxC))
      .attr("stroke-opacity", (d) => 0.35 + 0.65 * (d.s / maxS))
      .attr("stroke-dasharray", (d) => (d.s / maxS > 0.55 ? null : "1 5"));

    // Debris field
    if (DEBRIS) {
      const dg = par.append("g").attr("class", "debris clickable").attr("data-sys", DEBRIS.id);
      const rnd = mulberry(11);
      const vis = new Set(ST.debVis.map((m) => m.id));
      DEBRIS.members.forEach((m) => {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        dg.append("circle").attr("class", "debris-rock")
          .attr("cx", DEBRIS.gx + Math.cos(a) * rr * 105).attr("cy", DEBRIS.gy + Math.sin(a) * rr * 30)
          .attr("r", 0.9 + Math.sqrt(atlas.countOf(m, F)) * 0.35)
          .attr("fill", vis.has(m.id) ? "#9aa0ad" : "#3a3e48").attr("opacity", vis.has(m.id) ? 0.75 : 0.4);
      });
      dg.append("ellipse").attr("cx", DEBRIS.gx).attr("cy", DEBRIS.gy).attr("rx", 120).attr("ry", 40).attr("fill", "transparent").attr("stroke", "rgba(160,170,190,0.12)").attr("stroke-dasharray", "2 4");
      dg.append("text").attr("x", DEBRIS.gx).attr("y", DEBRIS.gy + 58).attr("text-anchor", "middle").style("font-size", "12px").style("font-weight", 600).style("fill", "#b7bdc9").text("Drifting debris · " + T.plural(ST.debVis.length, "concept"));
      dg.append("text").attr("x", DEBRIS.gx).attr("y", DEBRIS.gy + 74).attr("text-anchor", "middle").style("font-size", "10.5px").style("fill", "#7d8494").text("in papers, but no shared-paper links");
      dg.on("click", () => go({ sys: DEBRIS.id }))
        .on("mouseenter", (ev) => showTip(`<div class="tt">Drifting debris</div><div class="tm">${T.plural(ST.debVis.length, "concept")} · not part of any system</div><div class="tb">These concepts appear in papers, but the data has no shared-paper links for them (one-paper concepts and two catch-all categories). They are kept here, at the edge, rather than hidden.</div><div class="act">Click to look closer</div>`, ev))
        .on("mousemove", moveTip).on("mouseleave", hideTip);
    }

    // Stars, far ones first
    const order = SYS.slice().sort((a, b) => a.depth - b.depth);
    const stars = par.append("g").selectAll("g").data(order).join("g")
      .attr("class", (s) => `sys-star clickable${ST.sys[s.idx].vis.length ? "" : " dim"}`)
      .attr("data-sys", (s) => s.id)
      .attr("transform", (s) => `translate(${s.gx},${s.gy})`);
    stars.each(function (s) {
      const g = d3.select(this), r = starR(ST.sys[s.idx].count, s.depth);
      s.r = r;
      g.append("circle").attr("r", r * 3.4).attr("fill", `url(#glow-${s.id})`);
      g.append("path").attr("d", `M${-r * 2.4},0H${r * 2.4}M0,${-r * 2.1}V${r * 2.1}`).attr("stroke", s.color).attr("stroke-opacity", 0.28).attr("stroke-width", 1);
      g.append("circle").attr("class", "core").attr("r", r).attr("fill", `url(#core-${s.id})`);
      g.append("circle").attr("r", Math.max(r * 1.7, 22)).attr("fill", "transparent");
    });
    stars.on("click", (ev, s) => { hideTip(); go({ sys: s.id }); })
      .on("mouseenter", (ev, s) => {
        highlightRoutes(s.idx);
        const st = ST.sys[s.idx];
        const top = st.vis.slice(0, 6).map((m) => esc(m.label)).join(", ");
        const nb = neighborsOfSys(s.idx).slice(0, 2).map((x) => `${esc(shortName(sysName(SYS[x.j]), 34))} <span class="mono">(${x.c})</span>`).join("<br>");
        showTip(`<div class="tt">${esc(sysName(s))}</div><div class="tm">${T.plural(st.count, "paper")} · ${T.plural(st.vis.length, "concept")}</div>
          <div class="tb"><b>Includes</b> ${top || "nothing under these filters"}</div>
          ${nb ? `<div class="tb"><b>Shares most papers with</b><br>${nb}</div>` : ""}<div class="act">Click to travel in</div>`, ev);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", () => { highlightRoutes(null); hideTip(); });

    // Labels
    const circles = SYS.map((s) => ({ x: s.gx, y: s.gy, r: s.r + 3 }));
    if (DEBRIS) circles.push({ x: DEBRIS.gx, y: DEBRIS.gy + 30, r: 70 });
    const items = SYS.slice().sort((a, b) => ST.sys[b.idx].count - ST.sys[a.idx].count).map((s) => {
      const st = ST.sys[s.idx];
      const nm = sysName(s);
      const parts = nm.includes(" & ") ? [nm.split(" & ")[0] + " &", nm.split(" & ").slice(1).join(" & ")] : [nm];
      const lines = parts.map((t) => ({ text: t, size: 13, weight: 600 }));
      lines.push({ text: `${T.plural(st.count, "paper")} · ${T.plural(st.vis.length, "concept")}`, size: 10.5, mono: true, fill: s.color });
      const hint = st.vis.filter((m) => !nm.toLowerCase().includes(m.label.toLowerCase())).slice(0, 3).map((m) => m.label).join(", ");
      if (hint) lines.push({ text: shortName("with " + hint, 40), size: 11, fill: "#8f97a8" });
      const sz = linesSize(lines);
      return { id: s.id, x: s.gx, y: s.gy, r: s.r + 2, w: sz.w, h: sz.h, lines, self: circles[s.idx], s };
    });
    const lgEl = $("#legend").getBoundingClientRect();
    placeLabels(items, circles, { x0: 12, x1: W - 12, y0: 104, y1: H - 12 }, ["below", "right", "left", "above", "br", "tr", "bl", "tl"], [{ x: 0, y: H - 90, w: Math.max(lgEl.width, 420) + 30, h: 90 }]);
    const lg = par.append("g");
    items.forEach((it) => {
      drawLabel(lg, it, it.lines, `sys-label${ST.sys[it.s.idx].vis.length ? "" : " dim"}`);
    });
  }
  function neighborsOfSys(i) {
    return SYS.map((s, j) => ({ j, c: ST.shared[i][j] })).filter((x) => x.j !== i && x.c > 0).sort((a, b) => b.c - a.c);
  }
  function highlightRoutes(i) {
    gGal.selectAll(".route").classed("hl", function () { return i != null && (+this.dataset.a === i || +this.dataset.b === i); })
      .classed("dim", function () { return i != null && !(+this.dataset.a === i || +this.dataset.b === i); });
  }

  // =====================================================================
  // SYSTEM
  // =====================================================================
  let sysBuilt = null;
  const planetR = (count, depth = 0) => Math.min(22, 3.2 + 1.45 * Math.sqrt(count)) * (1 + 0.16 * depth);
  function systemLayout(sys) {
    const A = G.area;
    const cx = A.cx, cy = A.cy;
    const anchor = sys.anchor;
    const sR = Math.min(34, 20 + Math.sqrt(anchor.paperCount) * 0.8);
    const others = sys.members.filter((m) => m !== anchor);
    const maxS = d3.max(others, (m) => m.clusterStrength) || 1;
    const Rmin = sR + 62;
    const Rmax = Math.max(Rmin + 60, Math.min(A.w / 2 - 120, (A.h / 2 - 50) / TILT_S));
    const pl = others.map((m) => ({ m, R: Rmin + Math.pow(1 - m.clusterStrength / maxS, 0.85) * (Rmax - Rmin) }));
    pl.sort((a, b) => a.R - b.R);
    pl.forEach((p, i) => { p.th = i * 2.39996 + 0.5; });
    const pos = (p) => {
      p.depth = Math.sin(p.th);
      p.x = cx + p.R * Math.cos(p.th); p.y = cy + p.R * TILT_S * Math.sin(p.th);
      p.r0 = planetR(p.m.paperCount, p.depth);
    };
    pl.forEach(pos);
    for (let it = 0; it < 120; it++) {
      let moved = false;
      for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) {
        const a = pl[i], b = pl[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y), min = a.r0 + b.r0 + 14;
        if (d < min) {
          const sgn = Math.sin(b.th - a.th) >= 0 ? 1 : -1;
          a.th -= sgn * 0.025; b.th += sgn * 0.025; pos(a); pos(b); moved = true;
        }
      }
      if (!moved) break;
    }
    return { anchorId: anchor.id, cx, cy, sR, Rmin, Rmax, pl, byId: new Map(pl.map((p) => [p.m.id, p])) };
  }

  function buildSystem(sysId) {
    gSys.selectAll("*").remove();
    sysBuilt = sysId;
    const sys = atlas.clusterById.get(sysId);
    if (!sys) return;
    if (sys.unlinked) return buildDebris(sys);
    const L = systemLayout(sys);
    G.sysL = L;
    const root = gSys.append("g");
    const vis = new Set(ST.sys[sys.idx].vis.map((m) => m.id));
    const shown = L.pl.filter((p) => vis.has(p.m.id));
    shown.forEach((p) => { p.r = planetR(atlas.countOf(p.m, F), p.depth); });

    // Orbits
    root.append("g").selectAll("ellipse").data(shown).join("ellipse")
      .attr("class", "orbit").attr("data-id", (p) => p.m.id)
      .attr("cx", L.cx).attr("cy", L.cy).attr("rx", (p) => p.R).attr("ry", (p) => p.R * TILT_S);
    const hoverG = root.append("g");
    const back = root.append("g"), starG = root.append("g"), front = root.append("g"), labG = root.append("g");

    // Star = anchor concept
    const anchorVis = atlas.nodeVisible(sys.anchor, F);
    const sg = starG.append("g").attr("class", "clickable sys-core").attr("transform", `translate(${L.cx},${L.cy})`).style("opacity", anchorVis ? 1 : 0.35);
    sg.append("circle").attr("r", L.sR * 3.6).attr("fill", `url(#glow-${sys.id})`);
    sg.append("path").attr("d", `M${-L.sR * 2.6},0H${L.sR * 2.6}M0,${-L.sR * 2.2}V${L.sR * 2.2}`).attr("stroke", sys.color).attr("stroke-opacity", 0.3);
    sg.append("circle").attr("r", L.sR).attr("fill", `url(#core-${sys.id})`);
    sg.append("circle").attr("r", L.sR + 3).attr("fill", "none").attr("stroke", atlas.colorOf(sys.anchor.type)).attr("stroke-width", 2).attr("stroke-opacity", 0.8);
    sg.on("click", () => { hideTip(); go({ sys: sys.id, a: sys.anchor.id }); })
      .on("mouseenter", (ev) => { planetHover(sys.anchor, L.cx, L.cy, hoverG, L, vis); showTip(planetTip(sys.anchor, "The anchor of this system: the most central concept."), ev); })
      .on("mousemove", moveTip).on("mouseleave", () => { hoverG.selectAll("*").remove(); hideTip(); });

    const draw = (g, list) => {
      const sel = g.selectAll("g").data(list).join("g").attr("class", "planet clickable").attr("data-id", (p) => p.m.id)
        .attr("transform", (p) => `translate(${p.x},${p.y})`).style("opacity", (p) => (p.depth < 0 ? 0.82 + 0.18 * (1 + p.depth) : 1));
      sel.append("circle").attr("r", (p) => p.r * 2.1).attr("fill", (p) => `url(#halo-${p.m.type})`).attr("opacity", 0.55);
      sel.append("circle").attr("class", "body").attr("r", (p) => p.r).attr("fill", (p) => `url(#pl-${p.m.type})`);
      sel.append("circle").attr("r", (p) => p.r + 7).attr("fill", "transparent");
      sel.on("click", (ev, p) => { hideTip(); go({ sys: sys.id, a: p.m.id }); })
        .on("mouseenter", (ev, p) => {
          planetHover(p.m, p.x, p.y, hoverG, L, vis);
          const b = p.m.clusterStrength / (d3.max(L.pl, (q) => q.m.clusterStrength) || 1);
          showTip(planetTip(p.m, b > 0.66 ? "Core member: close to the star." : b > 0.33 ? "Firm member of this system." : "Loose member: on the outer edge."), ev);
        })
        .on("mousemove", moveTip).on("mouseleave", () => { hoverG.selectAll("*").remove(); gSys.selectAll(".orbit").classed("hl", false); hideTip(); });
    };
    draw(back, shown.filter((p) => p.depth < 0).sort((a, b) => a.depth - b.depth));
    draw(front, shown.filter((p) => p.depth >= 0).sort((a, b) => a.depth - b.depth));

    // Labels: star first, then by size
    const circles = shown.map((p) => ({ x: p.x, y: p.y, r: p.r + 1 }));
    const starC = { x: L.cx, y: L.cy, r: L.sR + 4 };
    circles.push(starC);
    const starLines = [{ text: sys.anchor.label, size: 15, weight: 600 }, { text: `${typeLabel(sys.anchor.type).toLowerCase()} · ${T.plural(atlas.countOf(sys.anchor, F), "paper")}`, size: 10.5, mono: true, fill: "#c8b98f" }];
    const items = [{ id: sys.anchor.id, x: L.cx, y: L.cy, r: L.sR + 4, ...linesSize(starLines), lines: starLines, self: starC }];
    shown.slice().sort((a, b) => b.r - a.r).forEach((p, i) => {
      const lines = [{ text: p.m.label, size: 12, weight: 500 }];
      items.push({ id: p.m.id, x: p.x, y: p.y, r: p.r + 1, ...linesSize(lines), lines, self: circles[shown.indexOf(p)] });
    });
    const gw = buildGateways(sys, L, root, circles);
    const obst = circles.concat(gw.map((g) => ({ x: g.x + g.w / 2, y: g.y + g.h / 2, r: Math.max(g.w, g.h) / 2 })));
    placeLabels(items, obst, { x0: G.area.x0 + 4, x1: G.area.x1, y0: G.area.y0 + 4, y1: G.area.y1 + 8 }, ["below", "right", "left", "above", "br", "tr", "bl", "tl"]);
    items.forEach((it, i) => drawLabel(labG, it, it.lines, i === 0 ? "plabel star-label" : "plabel"));
  }
  function planetTip(m, extra) {
    return `<div class="tt">${esc(m.label)}</div><div class="tm" style="color:${atlas.colorOf(m.type)}">${esc(typeLabel(m.type).toLowerCase())} · ${T.plural(atlas.countOf(m, F), "paper")}${atlas.rangeActive(F) ? " in " + rangeText() : ""}</div><div class="tb">${esc(extra)}</div><div class="act">Click to focus</div>`;
  }
  function planetHover(m, x, y, hoverG, L, vis) {
    hoverG.selectAll("*").remove();
    gSys.selectAll(".orbit").classed("hl", function () { return this.dataset.id === m.id; });
    atlas.neighbors(m.id, F).forEach(({ node, shared }) => {
      let p = L.byId.get(node.id), px, py;
      if (p && vis.has(node.id)) { px = p.x; py = p.y; } else if (node.id === L.anchorId) { px = L.cx; py = L.cy; } else return;
      hoverG.append("line").attr("class", "hover-link").attr("x1", x).attr("y1", y).attr("x2", px).attr("y2", py).attr("stroke-width", Math.min(4, 0.6 + Math.sqrt(shared) * 0.5));
    });
  }

  // Gateways: neighboring systems at the screen edge, in their real galaxy direction.
  function buildGateways(sys, L, root, obstacles = []) {
    const A = G.area;
    const nb = neighborsOfSys(sys.idx).slice(0, 5);
    const g = root.append("g");
    const boxes = nb.map(({ j, c }) => {
      const o = SYS[j];
      let dx = o.u - sys.u, dy = (o.v - sys.v) * TILT_G;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const name = shortName(sysName(o), 24);
      const w = Math.max(tw(name, 11.5, 600), tw(`${c} shared papers`, 10, 400, true)) + 52, h = 38;
      const ix0 = A.x0 + 8, ix1 = A.x1 - 8, iy0 = A.y0 + 6, iy1 = A.y1 - 6;
      const tx = dx > 0 ? (ix1 - L.cx) / dx : dx < 0 ? (ix0 - L.cx) / dx : Infinity;
      const ty = dy > 0 ? (iy1 - L.cy) / dy : dy < 0 ? (iy0 - L.cy) / dy : Infinity;
      const t = Math.min(tx, ty);
      let x = L.cx + dx * t - w / 2, y = L.cy + dy * t - h / 2;
      return { j, c, o, name, w, h, x, y, dx, dy };
    });
    const clamp = (b) => { b.x = Math.max(A.x0 + 6, Math.min(A.x1 - 6 - b.w, b.x)); b.y = Math.max(A.y0 + 6, Math.min(A.y1 - 6 - b.h, b.y)); };
    boxes.forEach(clamp);
    for (let it = 0; it < 60; it++) {
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const p = boxes[a], q = boxes[b];
        const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) + 8, oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) + 8;
        if (ox > 0 && oy > 0) {
          if (oy < ox) { const s = p.y < q.y ? -1 : 1; p.y += (s * oy) / 2; q.y -= (s * oy) / 2; }
          else { const s = p.x < q.x ? -1 : 1; p.x += (s * ox) / 2; q.x -= (s * ox) / 2; }
          clamp(p); clamp(q);
        }
      }
      boxes.forEach((p) => obstacles.forEach((c) => {
        const nx = Math.max(p.x, Math.min(c.x, p.x + p.w)), ny = Math.max(p.y, Math.min(c.y, p.y + p.h));
        const dd = Math.hypot(c.x - nx, c.y - ny), need = c.r + 8;
        if (dd < need) {
          const side = p.x <= A.x0 + 7 || p.x + p.w >= A.x1 - 7;
          if (side) p.y += (p.y + p.h / 2 < c.y ? -1 : 1) * (need - dd + 2);
          else p.x += (p.x + p.w / 2 < c.x ? -1 : 1) * (need - dd + 2);
          clamp(p);
        }
      }));
    }
    boxes.forEach((b) => {
      const gg = g.append("g").attr("class", "gateway").attr("transform", `translate(${b.x},${b.y})`);
      const beam = g.insert("path", ":first-child").attr("class", "gw-beam").attr("d", `M${L.cx + b.dx * (L.sR + 30)},${L.cy + b.dy * (L.sR + 30)}L${b.x + b.w / 2},${b.y + b.h / 2}`).style("opacity", 0);
      gg.append("rect").attr("width", b.w).attr("height", b.h).attr("rx", 11);
      const ang = Math.atan2(b.dy, b.dx) * 180 / Math.PI;
      gg.append("circle").attr("cx", 14).attr("cy", b.h / 2).attr("r", 4.5).attr("fill", b.o.color);
      gg.append("path").attr("d", "M-3.5,-4L4,0L-3.5,4L-1.5,0Z").attr("fill", "#ffd98a")
        .attr("transform", `translate(${b.w - 14},${b.h / 2}) rotate(${ang})`);
      gg.append("text").attr("x", 27).attr("y", 16).style("font-size", "11.5px").style("font-weight", 600).text(b.name);
      gg.append("text").attr("x", 27).attr("y", 30).attr("class", "mono").style("font-size", "10px").style("fill", "#c8b98f").text(`${b.c} shared papers`);
      gg.on("click", () => { hideTip(); go({ sys: b.o.id }); })
        .on("mouseenter", (ev) => { beam.style("opacity", 1); showTip(`<div class="tt">Gateway to ${esc(sysName(b.o))}</div><div class="tb">${T.plural(b.c, "paper")} study concepts from both systems. It lies in this direction in the galaxy.</div><div class="act">Click to travel there</div>`, ev); })
        .on("mousemove", moveTip).on("mouseleave", () => { beam.style("opacity", 0); hideTip(); });
    });
    return boxes;
  }

  function buildDebris(sys) {
    const A = G.area;
    const root = gSys.append("g");
    const cx = A.cx, cy = A.cy;
    const vis = ST.debVis;
    G.sysL = { cx, cy, byId: new Map(), sR: 0 };
    const rnd = mulberry(5);
    const Rx = Math.min(A.w / 2 - 120, 440), Ry = Math.min(A.h / 2 - 60, 260);
    const pts = vis.map((m, i) => {
      const th = i * 2.39996 + rnd() * 0.3, rr = 0.25 + 0.75 * Math.sqrt((i + 0.5) / Math.max(1, vis.length));
      return { m, x: cx + Math.cos(th) * rr * Rx, y: cy + Math.sin(th) * rr * Ry, r: Math.min(14, 2.5 + Math.sqrt(atlas.countOf(m, F)) * 0.9) };
    });
    pts.forEach((p) => G.sysL.byId.set(p.m.id, p));
    root.append("ellipse").attr("cx", cx).attr("cy", cy).attr("rx", Rx + 30).attr("ry", Ry + 20).attr("fill", "none").attr("stroke", "rgba(160,170,190,0.1)").attr("stroke-dasharray", "2 5");
    const sel = root.append("g").selectAll("g").data(pts).join("g").attr("class", "planet clickable").attr("transform", (p) => `translate(${p.x},${p.y})`);
    sel.append("path").attr("class", "body").attr("d", (p) => rockPath(p.r, rnd)).attr("fill", (p) => d3.color(atlas.colorOf(p.m.type)).darker(0.6)).attr("stroke", (p) => atlas.colorOf(p.m.type)).attr("stroke-opacity", 0.6);
    sel.append("circle").attr("r", (p) => p.r + 6).attr("fill", "transparent");
    sel.on("click", (ev, p) => { hideTip(); go({ sys: sys.id, a: p.m.id }); })
      .on("mouseenter", (ev, p) => showTip(planetTip(p.m, "No shared-paper links in the data."), ev))
      .on("mousemove", moveTip).on("mouseleave", hideTip);
    const circles = pts.map((p) => ({ x: p.x, y: p.y, r: p.r + 1 }));
    const items = pts.slice().sort((a, b) => b.r - a.r).map((p) => {
      const lines = [{ text: p.m.label, size: 11.5 }];
      return { id: p.m.id, x: p.x, y: p.y, r: p.r, ...linesSize(lines), lines, self: circles[pts.indexOf(p)] };
    });
    placeLabels(items, circles, { x0: A.x0, x1: A.x1, y0: A.y0, y1: A.y1 });
    const lg = root.append("g");
    items.forEach((it) => drawLabel(lg, it, it.lines));
  }
  function rockPath(r, rnd) {
    const k = 7, pts = [];
    for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2, rr = r * (0.75 + rnd() * 0.4); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    return "M" + pts.map((p) => p.join(",")).join("L") + "Z";
  }

  // =====================================================================
  // FOCUS LEVELS: concept, connection, paper
  // =====================================================================
  const focusR = (count) => Math.min(34, 16 + Math.sqrt(count) * 1.1);
  function drawBody(g, m, x, y, r, opts = {}) {
    const b = g.append("g").attr("transform", `translate(${x},${y})`).attr("class", opts.cls || null);
    b.append("circle").attr("r", r * 2.4).attr("fill", `url(#halo-${m.type})`).attr("opacity", 0.8);
    b.append("circle").attr("class", "body").attr("r", r).attr("fill", `url(#pl-${m.type})`);
    if (opts.ring) b.append("circle").attr("class", "ring").attr("r", r + 4.5).attr("stroke", opts.ring).attr("stroke-width", 1.4).attr("fill", "none").attr("stroke-dasharray", opts.dashed ? "2.5 2.5" : null);
    b.append("circle").attr("r", r + 7).attr("fill", "transparent");
    return b;
  }

  function buildConcept(route, root) {
    const A = G.area, m = atlas.byId.get(route.a);
    const fx = A.cx, fy = A.cy;
    const cnt = atlas.countOf(m, F);
    const fr = focusR(cnt);
    const nbAll = atlas.neighbors(m.id, F);
    const nb = nbAll.slice(0, MOON_MAX);
    const maxS = nb.length ? nb[0].shared : 1;
    const Rmin = fr + 72, Rmax = Math.max(Rmin + 40, Math.min(A.w / 2 - 120, (A.h / 2 - 64) / TILT_S));
    const step = (Math.PI * 2) / Math.max(1, nb.length);
    const moons = nb.map((x, i) => {
      const th = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * step + 0.35;
      return { ...x, th, R: Rmin + Math.pow(1 - x.shared / maxS, 0.9) * (Rmax - Rmin), ext: x.node.cluster !== m.cluster };
    });
    const pos = (p) => { p.depth = Math.sin(p.th); p.x = fx + p.R * Math.cos(p.th); p.y = fy + p.R * TILT_S * Math.sin(p.th); p.r = Math.min(16, 4 + Math.sqrt(p.shared) * 1.9) * (1 + 0.15 * p.depth); };
    moons.forEach(pos);
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let i = 0; i < moons.length; i++) for (let j = i + 1; j < moons.length; j++) {
        const a = moons[i], b = moons[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 18) { const s = Math.sin(b.th - a.th) >= 0 ? 1 : -1; a.th -= s * 0.03; b.th += s * 0.03; pos(a); pos(b); moved = true; }
      }
      if (!moved) break;
    }
    // orbit guides: 3 faint rings marking shared-paper distance
    [0, 0.5, 1].forEach((t) => {
      const R = Rmin + t * (Rmax - Rmin);
      root.append("ellipse").attr("class", "orbit").attr("cx", fx).attr("cy", fy).attr("rx", R).attr("ry", R * TILT_S).style("stroke-dasharray", "2 5");
    });
    const tg = root.append("g");
    const back = root.append("g"), mid = root.append("g"), front = root.append("g"), labG = root.append("g");
    moons.forEach((p) => {
      tg.append("line").attr("class", "tether").attr("data-id", p.node.id).attr("x1", fx).attr("y1", fy).attr("x2", p.x).attr("y2", p.y)
        .attr("stroke", atlas.colorOf(p.node.type)).attr("stroke-opacity", 0.38).attr("stroke-width", 0.7 + Math.sqrt(p.shared) * 0.7);
    });
    drawBody(mid, m, fx, fy, fr, { ring: "#fff" }).select(".ring").attr("stroke-opacity", 0.35);
    moons.slice().sort((a, b) => a.depth - b.depth).forEach((p) => {
      const g = drawBody(p.depth < 0 ? back : front, p.node, p.x, p.y, p.r, { cls: `moon clickable${p.ext ? " ext" : ""}`, ring: p.ext ? "#ffd98a" : null, dashed: true });
      g.attr("data-id", p.node.id).style("opacity", p.depth < 0 ? 0.85 : 1);
      g.on("click", () => { hideTip(); go({ sys: route.sys, a: m.id, b: p.node.id }); })
        .on("mouseenter", (ev) => {
          highlightMoon(p.node.id, true);
          const ex = atlas.explainConnection(m.id, p.node.id, F);
          showTip(`<div class="tt">${esc(p.node.label)}</div><div class="tm" style="color:${atlas.colorOf(p.node.type)}">${esc(typeLabel(p.node.type).toLowerCase())}${p.ext ? ` · in ${esc(shortName(sysName(atlas.clusterById.get(p.node.cluster)), 34))}` : ""}</div><div class="tb">${esc(T.cap(ex.sentence))}.</div><div class="tb">${liftPhrase(ex.lift)}</div><div class="act">Click to see why they connect</div>`, ev);
        })
        .on("mousemove", moveTip).on("mouseleave", () => { highlightMoon(p.node.id, false); hideTip(); });
    });
    const circles = moons.map((p) => ({ x: p.x, y: p.y, r: p.r + 1 }));
    const fc = { x: fx, y: fy, r: fr + 6 };
    circles.push(fc);
    const fl = [{ text: m.label, size: 17, weight: 600 }, { text: `${typeLabel(m.type).toLowerCase()} · ${T.plural(cnt, "paper")}`, size: 11, mono: true, fill: atlas.colorOf(m.type) }];
    const items = [{ id: m.id, x: fx, y: fy, r: fr + 6, ...linesSize(fl), lines: fl, self: fc }];
    moons.forEach((p, i) => {
      const lines = [{ text: p.node.label, size: 12, weight: 500 }, { text: `${p.shared} shared${p.ext ? " · other system" : ""}`, size: 10, mono: true, fill: p.ext ? "#ffd98a" : "#8f97a8" }];
      items.push({ id: p.node.id, x: p.x, y: p.y, r: p.r + 2, ...linesSize(lines), lines, self: circles[i] });
    });
    placeLabels(items, circles, { x0: A.x0 + 4, x1: A.x1, y0: A.y0 + 4, y1: A.y1 + 8 }, ["below", "right", "left", "above", "br", "tr", "bl", "tl"]);
    items.forEach((it) => drawLabel(labG, it, it.lines));
    if (!nb.length) {
      const msg = m.cluster === DEBRIS?.id ? "No shared-paper links for this concept in the data." : !cnt ? `No papers in ${rangeText()} for this concept.` : `No connections match ${filterDesc() || "these filters"}.`;
      root.append("text").attr("x", fx).attr("y", fy + fr + 70).attr("text-anchor", "middle").style("font-size", "13px").style("fill", "#a0a8b8").text(msg);
    }
  }
  function highlightMoon(id, on) {
    gFocus.selectAll(".tether").attr("stroke-opacity", function () { return on ? (this.dataset.id === id ? 0.9 : 0.12) : 0.38; });
    d3.selectAll("#panel .row[data-id]").classed("hl", function () { return on && this.dataset.id === id; });
  }
  function liftPhrase(lift) {
    if (!lift) return "";
    if (lift >= 1.1) return `Studied together <b>${lift.toFixed(1)}×</b> more often than chance would predict.`;
    if (lift <= 0.9) return `Studied together <b>less often</b> than chance would predict (${lift.toFixed(1)}×).`;
    return `Studied together <b>about as often as chance</b> would predict.`;
  }

  function buildConnection(route, root) {
    const A = G.area;
    const a = atlas.byId.get(route.a), b = atlas.byId.get(route.b);
    const ex = atlas.explainConnection(a.id, b.id, F);
    const fy = A.cy - 30;
    const D = Math.min(A.w / 2 - 130, 340);
    const ax = A.cx - D, bx = A.cx + D;
    const ra = focusR(atlas.countOf(a, F)), rb = focusR(atlas.countOf(b, F));
    const x0 = ax + ra + 34, x1 = bx - rb - 34;
    const [y0, y1] = F.range;
    const xs = d3.scaleLinear().domain([y0, y1]).range([x0, x1]);
    const defs = root.append("defs");
    const lg = defs.append("linearGradient").attr("id", "bridge-grad").attr("gradientUnits", "userSpaceOnUse").attr("x1", ax).attr("x2", bx).attr("y1", fy).attr("y2", fy);
    lg.append("stop").attr("offset", "0%").attr("stop-color", atlas.colorOf(a.type));
    lg.append("stop").attr("offset", "100%").attr("stop-color", atlas.colorOf(b.type));
    root.append("path").attr("d", `M${ax},${fy}L${bx},${fy}`).attr("stroke", "url(#bridge-grad)").attr("stroke-width", 2).attr("stroke-opacity", 0.6);
    // ticks
    const ticks = xs.ticks(Math.max(3, Math.min(8, Math.floor((x1 - x0) / 90))));
    const tg = root.append("g");
    ticks.forEach((t) => {
      tg.append("line").attr("x1", xs(t)).attr("x2", xs(t)).attr("y1", fy - 4).attr("y2", fy + 4).attr("stroke", "rgba(255,255,255,0.3)");
      tg.append("text").attr("class", "axis-t mono").attr("x", xs(t)).attr("y", fy - 9).attr("text-anchor", "middle").text(t);
    });
    // paper dots stacked by year, hanging from the bridge
    const byYear = d3.group(ex.papers, (p) => p.year);
    const maxCol = d3.max([...byYear.values()], (v) => v.length) || 1;
    const sp = Math.min(14, (A.y1 - fy - 60) / maxCol);
    const dr = Math.max(2, Math.min(5, sp * 0.4));
    const dots = [];
    byYear.forEach((list, yr) => list.forEach((p, i) => dots.push({ p, x: xs(yr), y: fy + 12 + i * sp })));
    root.append("g").selectAll("circle").data(dots).join("circle").attr("class", "pdot")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", dr).attr("fill", "#ffd98a").attr("fill-opacity", 0.85)
      .on("click", (ev, d) => { hideTip(); go({ ...route, p: d.p.paper_id }); })
      .on("mouseenter", (ev, d) => showTip(`<div class="tt">${esc(T.paperTitle(d.p))}</div><div class="tm">${esc(d.p.authors || "")} · ${d.p.year}</div><div class="act">Click to open the paper</div>`, ev))
      .on("mousemove", moveTip).on("mouseleave", hideTip);
    if (!dots.length) root.append("text").attr("x", A.cx).attr("y", fy + 40).attr("text-anchor", "middle").style("fill", "#a0a8b8").style("font-size", "13px").text(`No shared papers in ${rangeText()}.`);
    // bodies
    [[a, ax, ra], [b, bx, rb]].forEach(([m, x, r]) => {
      const g = drawBody(root, m, x, fy, r, { cls: "moon clickable" });
      g.on("click", () => go({ sys: m.cluster, a: m.id })).on("mouseenter", (ev) => showTip(planetTip(m, "Open this concept."), ev)).on("mousemove", moveTip).on("mouseleave", hideTip);
      const lines = [{ text: m.label, size: 15, weight: 600 }, { text: `${typeLabel(m.type).toLowerCase()} · ${T.plural(atlas.countOf(m, F), "paper")}`, size: 10.5, mono: true, fill: atlas.colorOf(m.type) }];
      const sz = linesSize(lines);
      const bxx = Math.max(A.x0 + 6, Math.min(A.x1 - sz.w, x - sz.w / 2));
      const it = { x, y: fy, r, box: { x: bxx, y: fy - r - 16 - sz.h, w: sz.w, h: sz.h, anchor: "middle", d: 0 } };
      drawLabel(root, it, lines);
    });
    root.append("text").attr("x", A.cx).attr("y", fy - 64).attr("text-anchor", "middle").attr("class", "mono").style("font-size", "11px").style("fill", "#c8b98f")
      .text(`${T.plural(ex.n, "shared paper")} · one dot each, by year`);
  }

  function buildPaper(route, root) {
    const A = G.area;
    const p = atlas.paperById.get(route.p);
    const cs = atlas.conceptsOfPaper(p.paper_id);
    const fx = A.cx, fy = A.cy;
    const R = Math.min(A.w / 2 - 150, 300), TL = 0.62;
    const pts = cs.map((m, i) => {
      const th = -Math.PI / 2 + (i + 0.5) * ((Math.PI * 2) / cs.length);
      const depth = Math.sin(th);
      return { m, th, depth, x: fx + R * Math.cos(th), y: fy + R * TL * Math.sin(th), r: Math.min(15, 5 + Math.sqrt(atlas.countOf(m, F)) * 0.75) * (1 + 0.14 * depth) };
    });
    root.append("ellipse").attr("class", "orbit").attr("cx", fx).attr("cy", fy).attr("rx", R).attr("ry", R * TL).style("stroke-dasharray", "2 5");
    pts.forEach((q) => root.append("line").attr("x1", fx).attr("y1", fy).attr("x2", q.x).attr("y2", q.y).attr("stroke", atlas.colorOf(q.m.type)).attr("stroke-opacity", 0.35).attr("stroke-width", 1.2));
    // probe
    const pg = root.append("g").attr("transform", `translate(${fx},${fy})`);
    pg.append("circle").attr("r", 46).attr("fill", "url(#probe-glow)");
    pg.append("rect").attr("x", -11).attr("y", -11).attr("width", 22).attr("height", 22).attr("transform", "rotate(45)").attr("fill", "#fff3d0").attr("stroke", "#ffd98a").attr("stroke-width", 2);
    const pl = [{ text: `paper · ${p.year}`, size: 11, mono: true, fill: "#ffd98a" }, { text: shortName(T.paperTitle(p), 46), size: 13, weight: 600 }];
    const hl = new Set([route.a, route.b].filter(Boolean));
    const circles = pts.map((q) => ({ x: q.x, y: q.y, r: q.r + 1 }));
    const pc = { x: fx, y: fy, r: 20 };
    circles.push(pc);
    const items = [{ x: fx, y: fy, r: 20, ...linesSize(pl), lines: pl, self: pc }];
    pts.forEach((q, i) => {
      const g = drawBody(root, q.m, q.x, q.y, q.r, { cls: "moon clickable", ring: hl.has(q.m.id) ? "#ffd98a" : null });
      g.on("click", () => { hideTip(); go({ sys: q.m.cluster, a: q.m.id }); })
        .on("mouseenter", (ev) => showTip(planetTip(q.m, `In ${sysName(atlas.clusterById.get(q.m.cluster))}.`), ev)).on("mousemove", moveTip).on("mouseleave", hideTip);
      const lines = [{ text: q.m.label, size: 12, weight: hl.has(q.m.id) ? 600 : 500, fill: hl.has(q.m.id) ? "#ffe9b0" : null }, { text: typeLabel(q.m.type).toLowerCase(), size: 10, mono: true, fill: atlas.colorOf(q.m.type) }];
      items.push({ x: q.x, y: q.y, r: q.r + 2, ...linesSize(lines), lines, self: circles[i] });
    });
    placeLabels(items, circles, { x0: A.x0 + 4, x1: A.x1, y0: A.y0 + 4, y1: A.y1 + 8 }, ["below", "right", "left", "above", "br", "tr", "bl", "tl"]);
    items.forEach((it) => drawLabel(root, it, it.lines));
  }

  // =====================================================================
  // PANEL
  // =====================================================================
  const pb = $("#panel-body");
  const dot = (m) => `<span class="dot" style="background:${atlas.colorOf(m.type)}"></span>`;
  function spark(counts, color, w = 340, h = 46) {
    const [r0, r1] = F.range;
    const max = d3.max(counts) || 1;
    const bw = w / counts.length;
    let s = `<svg class="spark" viewBox="0 0 ${w} ${h + 14}" preserveAspectRatio="none">`;
    counts.forEach((c, i) => {
      const y = atlas.Y0 + i, inR = y >= r0 && y <= r1;
      const bh = c ? Math.max(2, (c / max) * h) : 1;
      s += `<rect x="${i * bw + 0.5}" y="${h - bh}" width="${Math.max(1, bw - 1.5)}" height="${bh}" rx="1" fill="${c ? color : "#2a2f3c"}" opacity="${inR ? 0.95 : 0.22}"><title>${y}: ${c}</title></rect>`;
    });
    s += `<text x="0" y="${h + 12}" font-size="9.5" fill="#6d7486" font-family="IBM Plex Mono">${atlas.Y0}</text><text x="${w}" y="${h + 12}" text-anchor="end" font-size="9.5" fill="#6d7486" font-family="IBM Plex Mono">${atlas.Y1}</text></svg>`;
    return s;
  }
  function yearCounts(papers) {
    const c = new Array(atlas.Y1 - atlas.Y0 + 1).fill(0);
    papers.forEach((p) => { if (p.year >= atlas.Y0 && p.year <= atlas.Y1) c[p.year - atlas.Y0]++; });
    return c;
  }
  function paperRows(list, route, limit, extra) {
    const id = "pl" + Math.random().toString(36).slice(2, 7);
    const row = (p) => `<button class="paper-row" data-p="${p.paper_id}"><div class="t">${esc(T.paperTitle(p))}</div><div class="m">${esc(p.authors || "")} · ${p.year}${extra ? extra(p) : ""}</div></button>`;
    let h = `<div class="rows" id="${id}">${list.slice(0, limit).map(row).join("")}</div>`;
    if (list.length > limit) h += `<button class="link-btn more-btn" data-more="${id}">Show all ${list.length}</button>`;
    setTimeout(() => {
      const more = pb.querySelector(`[data-more="${id}"]`);
      if (more) more.onclick = () => { pb.querySelector("#" + id).innerHTML = list.map(row).join(""); more.remove(); wirePapers(route); };
    });
    return h;
  }
  function wirePapers(route) {
    pb.querySelectorAll(".paper-row[data-p]").forEach((el) => { el.onclick = () => go({ ...route, p: +el.dataset.p || el.dataset.p }); });
  }
  function wireConcepts() {
    pb.querySelectorAll("[data-concept]").forEach((el) => { el.onclick = () => { const m = atlas.byId.get(el.dataset.concept); go({ sys: m.cluster, a: m.id }); }; });
  }

  function panelSystem(sys) {
    if (sys.unlinked) {
      const vis = ST.debVis;
      pb.innerHTML = `<div class="eyebrow"><span class="dot" style="background:#8a8f9c"></span>Edge of the galaxy</div>
        <div class="p-title">Drifting debris</div>
        <div class="p-sub">${T.plural(vis.length, "concept")} that appear in papers but have <b>no shared-paper links</b> in the data, so they belong to no system. Most come from a single paper; two are catch-all categories (such as “no design object”) that the graph deliberately leaves unlinked.</div>
        <div class="section"><h3>Concepts <span class="mono">papers</span></h3><div class="rows">${vis.map((m) => `<button class="row" data-concept="${m.id}">${dot(m)}<span class="lbl">${esc(m.label)}</span><span class="val">${atlas.countOf(m, F)}</span></button>`).join("") || `<div class="empty-note">No debris concepts match ${esc(filterDesc())}.</div>`}</div></div>`;
      wireConcepts();
      return;
    }
    const st = ST.sys[sys.idx];
    const maxS = d3.max(sys.members, (m) => m.clusterStrength) || 1;
    const nb = neighborsOfSys(sys.idx);
    const counts = yearCounts([...st.set].map((id) => atlas.paperById.get(id)));
    pb.innerHTML = `<div class="eyebrow"><span class="dot" style="background:${sys.color};box-shadow:0 0 8px ${sys.color}"></span>Star system</div>
      <div class="p-title">${esc(sysName(sys))}</div>
      <div class="p-sub">A neighborhood of concepts that are often studied in the same papers. Its star is <a data-concept="${sys.anchor.id}">${esc(sys.anchor.label)}</a>, the most central member.</div>
      <div class="stats"><div class="stat"><b>${st.count}</b><span>papers${atlas.rangeActive(F) ? " in range" : ""}</span></div><div class="stat"><b>${st.vis.length}</b><span>concepts shown</span></div><div class="stat"><b>${nb.length}</b><span>linked systems</span></div></div>
      <div class="section"><h3>Papers per year</h3>${spark(counts, sys.color)}</div>
      <div class="section"><h3>Members, core to edge <span class="mono">papers</span></h3><div class="rows">
      ${st.vis.map((m) => `<button class="row" data-id="${m.id}" data-concept="${m.id}">${dot(m)}<span class="lbl">${esc(m.label)}${m === sys.anchor ? "<small>star · anchor</small>" : ""}</span><span class="val"><span class="bar" title="How tightly it belongs"><i style="width:${Math.round((m.clusterStrength / maxS) * 100)}%"></i></span>${atlas.countOf(m, F)}</span></button>`).join("") || `<div class="empty-note">No members match ${esc(filterDesc())}.</div>`}
      </div><div class="note">The bar shows how tightly each concept belongs (its orbit distance).</div></div>
      <div class="section"><h3>Neighboring systems <span class="mono">shared papers</span></h3><div class="rows">
      ${nb.slice(0, 8).map((x) => `<button class="row" data-sys="${SYS[x.j].id}"><span class="dot" style="background:${SYS[x.j].color}"></span><span class="lbl">${esc(sysName(SYS[x.j]))}</span><span class="val">${x.c}</span></button>`).join("")}
      </div></div>`;
    wireConcepts();
    pb.querySelectorAll("[data-sys]").forEach((el) => { el.onclick = () => go({ sys: el.dataset.sys }); });
    pb.querySelectorAll(".row[data-id]").forEach((el) => {
      el.onmouseenter = () => { gSys.selectAll(".planet").classed("dim", function () { return this.dataset.id !== el.dataset.id; }); gSys.selectAll(".orbit").classed("hl", function () { return this.dataset.id === el.dataset.id; }); };
      el.onmouseleave = () => { gSys.selectAll(".planet").classed("dim", false); gSys.selectAll(".orbit").classed("hl", false); };
    });
  }

  function panelConcept(route) {
    const m = atlas.byId.get(route.a);
    const sys = atlas.clusterById.get(m.cluster);
    const nb = atlas.neighbors(m.id, F);
    const papers = atlas.papersIn(m.papers, F).slice().sort((a, b) => b.year - a.year);
    const maxS = nb.length ? nb[0].shared : 1;
    const t = atlas.typeOf(m.type);
    const rowsHtml = (list) => list.map((x) => {
      const ext = x.node.cluster !== m.cluster;
      return `<button class="row" data-id="${x.node.id}" style="--c:${atlas.colorOf(x.node.type)}"><span class="dot${ext ? " ext" : ""}" style="background:${atlas.colorOf(x.node.type)}"></span><span class="lbl">${esc(x.node.label)}${ext ? `<small>↗ ${esc(shortName(sysName(atlas.clusterById.get(x.node.cluster)), 40))}</small>` : ""}</span><span class="val"><span class="bar"><i style="width:${Math.round((x.shared / maxS) * 100)}%"></i></span>${x.shared}</span></button>`;
    }).join("");
    pb.innerHTML = `<div class="eyebrow"><span class="dot" style="background:${t.color}"></span>${esc(t.label)}</div>
      <div class="p-title">${esc(m.label)}</div>
      <div class="p-sub">In <a data-sys="${sys.id}">${esc(sysName(sys))}</a>${t.definition ? ` · <span class="faint">${esc(t.label)}s are ${esc(t.definition.charAt(0).toLowerCase() + t.definition.slice(1))}</span>` : ""}</div>
      ${m.description ? `<p class="p-desc">${esc(m.description)}</p>` : ""}
      <div class="stats"><div class="stat"><b>${papers.length}</b><span>papers${atlas.rangeActive(F) ? " in range" : ""}</span></div><div class="stat"><b>${nb.length}</b><span>connections</span></div><div class="stat"><b>${m.firstYear || "–"}</b><span>first seen</span></div></div>
      <div class="section"><h3>Papers per year</h3>${spark(m.yearCounts, t.color)}</div>
      <div class="section"><h3>Strongest connections <span class="mono">shared papers</span></h3>
        ${nb.length ? `<div class="rows" id="nb-rows">${rowsHtml(nb.slice(0, 20))}</div>${nb.length > 20 ? `<button class="link-btn more-btn" id="nb-more">Show all ${nb.length}</button>` : ""}<div class="note">The top ${Math.min(MOON_MAX, nb.length)} are drawn as moons. A hollow dot means the concept lives in another system.</div>`
          : `<div class="empty-note">${sys.unlinked ? "This concept has no shared-paper links in the data." : `No connections match ${esc(filterDesc() || "these filters")}.`}</div>`}
      </div>
      <div class="section"><h3>Papers <span class="mono">${papers.length}</span></h3>${papers.length ? paperRows(papers, route, 6) : `<div class="empty-note">No papers in ${rangeText()}.</div>`}</div>`;
    const wireRows = () => pb.querySelectorAll(".row[data-id]").forEach((el) => {
      el.onclick = () => go({ sys: route.sys, a: m.id, b: el.dataset.id });
      el.onmouseenter = () => highlightMoon(el.dataset.id, true);
      el.onmouseleave = () => highlightMoon(el.dataset.id, false);
    });
    wireRows();
    const more = pb.querySelector("#nb-more");
    if (more) more.onclick = () => { pb.querySelector("#nb-rows").innerHTML = rowsHtml(nb); more.remove(); wireRows(); };
    pb.querySelectorAll("[data-sys]").forEach((el) => { el.onclick = () => go({ sys: el.dataset.sys }); });
    wirePapers(route);
  }

  function panelConnection(route) {
    const ex = atlas.explainConnection(route.a, route.b, F);
    const { a, b } = ex;
    const pct = (x) => Math.round(x * 100) + "%";
    const expected = ex.lift ? ex.n / ex.lift : 0;
    const sentence = esc(T.cap(ex.sentence)).replace(/^(\d+ papers?)/, "<em>$1</em>");
    pb.innerHTML = `<div class="eyebrow">Connection</div>
      <div class="p-title" style="font-size:18px"><button class="inline-link" data-concept="${a.id}" style="color:${atlas.colorOf(a.type)}">${esc(a.label)}</button> <span class="faint">↔</span> <button class="inline-link" data-concept="${b.id}" style="color:${atlas.colorOf(b.type)}">${esc(b.label)}</button></div>
      <div class="sentence">${sentence}.</div>
      ${ex.n ? `<div class="callout">${liftPhrase(ex.lift)}${expected ? ` If the two were unrelated, about ${expected < 1 ? expected.toFixed(1) : Math.round(expected)} shared paper${Math.round(expected) === 1 ? "" : "s"} would be expected.` : ""}</div>` : ""}
      <div class="section"><h3>How much of each</h3><div class="share">
        <div class="share-row"><span><b>${pct(ex.shareOfA)}</b> of ${esc(a.label)} papers also study ${esc(b.label)}</span><span class="bar"><i style="width:${pct(ex.shareOfA)};background:${atlas.colorOf(a.type)}"></i></span></div>
        <div class="share-row"><span><b>${pct(ex.shareOfB)}</b> of ${esc(b.label)} papers also study ${esc(a.label)}</span><span class="bar"><i style="width:${pct(ex.shareOfB)};background:${atlas.colorOf(b.type)}"></i></span></div>
      </div></div>
      <div class="section"><h3>Over time</h3>${spark(yearCounts(ex.papers), "#ffd98a", 340, 34)}<div class="note" style="color:var(--muted)">${ex.n === 1 ? `Published in ${ex.papers[0].year}.` : esc(ex.trend)}</div></div>
      <div class="section"><h3>What else these papers study <span class="mono">of ${ex.n}</span></h3>
        ${ex.alongside.length ? `<div class="tags">${ex.alongside.slice(0, 14).map((x) => `<button class="tag" data-concept="${x.node.id}" style="--c:${atlas.colorOf(x.node.type)}">${dot(x.node)}${esc(x.node.label)} <span class="n">${x.count}</span></button>`).join("")}</div>` : `<div class="empty-note">Nothing else in common.</div>`}
      </div>
      <div class="section"><h3>Shared papers <span class="mono">${ex.n}</span></h3>${ex.n ? paperRows(ex.papers, route, 8) : `<div class="empty-note">No shared papers in ${rangeText()}.</div>`}</div>`;
    wireConcepts(); wirePapers(route);
  }

  function panelPaper(route) {
    const p = atlas.paperById.get(route.p);
    const cs = atlas.conceptsOfPaper(p.paper_id);
    const groups = atlas.types.map((t) => ({ t, list: cs.filter((m) => m.type === t.id) })).filter((g) => g.list.length);
    const rel = atlas.relatedPapers(p.paper_id, 6);
    const hl = new Set([route.a, route.b].filter(Boolean));
    pb.innerHTML = `<div class="eyebrow"><span class="dot" style="background:#ffd98a"></span>Paper · ${p.year}</div>
      <div class="p-title paper">${esc(T.paperTitle(p))}</div>
      <div class="p-sub">${esc(p.authors || "Authors unavailable")} · ${p.year}</div>
      <a class="scholar" href="${atlas.paperLink(p)}" target="_blank" rel="noopener">Find on Google Scholar ↗</a>
      <div class="note">The data has titles, authors and years only (no abstracts or DOIs).</div>
      <div class="section"><h3>Concepts it studies <span class="mono">${cs.length}</span></h3>
      ${groups.map((g) => `<div class="type-group"><div class="tg-h">${esc(g.t.plural)}</div><div class="tags">${g.list.map((m) => `<button class="tag${hl.has(m.id) ? " hl" : ""}" data-concept="${m.id}" style="--c:${g.t.color}" title="Jump to it in ${esc(sysName(atlas.clusterById.get(m.cluster)))}">${dot(m)}${esc(m.label)}</button>`).join("")}</div></div>`).join("")}
      </div>
      <div class="section"><h3>Related papers <span class="mono">concepts in common</span></h3>${paperRows(rel.map((r) => r.paper), route, 6, (q) => { const r = rel.find((x) => x.paper === q); return r ? ` · <span class="shared">${r.shared.length} shared: ${esc(shortName(r.shared.map((m) => m.label).join(", "), 60))}</span>` : ""; })}</div>`;
    wireConcepts(); wirePapers(route);
  }

  // ---------- Minimap ----------
  function buildMinimap(route) {
    const el = $("#minimap svg");
    const w = el.clientWidth || PW - 24, h = 92;
    const s = d3.select(el);
    s.attr("viewBox", `0 0 ${w} ${h}`).selectAll("*").remove();
    const maxU = G.maxU, maxV = G.maxV;
    const k = Math.min((w - 30) / 2 / maxU, (h - 22) / 2 / (maxV * TILT_G));
    const px = (x) => w / 2 + x.u * k, py = (x) => h / 2 + 6 + x.v * k * TILT_G;
    (G.routes || []).forEach((r) => s.append("line").attr("x1", px(SYS[r.i])).attr("y1", py(SYS[r.i])).attr("x2", px(SYS[r.j])).attr("y2", py(SYS[r.j])).attr("stroke", "rgba(255,217,138,0.15)"));
    const cur = route.sys;
    SYS.forEach((x) => {
      const g = s.append("g").attr("class", "mm-star").attr("transform", `translate(${px(x)},${py(x)})`);
      const r = 1.6 + Math.sqrt(ST.sys[x.idx].count) * 0.2;
      if (x.id === cur) {
        g.append("circle").attr("r", r + 6).attr("fill", "none").attr("stroke", "#ffd98a").attr("stroke-width", 1.3);
        g.append("circle").attr("r", r + 11).attr("fill", "none").attr("stroke", "#ffd98a").attr("stroke-opacity", 0.3);
      }
      g.append("circle").attr("class", "core").attr("r", r).attr("fill", x.color).attr("opacity", ST.sys[x.idx].vis.length ? 1 : 0.3);
      g.append("circle").attr("r", 8).attr("fill", "transparent");
      g.append("title").text(sysName(x));
      g.on("click", () => go({ sys: x.id }));
    });
    if (DEBRIS) {
      const g = s.append("g").attr("class", "mm-star").attr("transform", `translate(${w - 18},${h - 10})`);
      if (cur === DEBRIS.id) g.append("circle").attr("r", 9).attr("fill", "none").attr("stroke", "#ffd98a");
      [[-5, 1], [0, -2], [4, 2], [-2, 3], [6, -1]].forEach(([x, y]) => g.append("circle").attr("class", "core").attr("cx", x).attr("cy", y).attr("r", 1).attr("fill", "#8a8f9c"));
      g.append("circle").attr("r", 9).attr("fill", "transparent");
      g.append("title").text("Drifting debris");
      g.on("click", () => go({ sys: DEBRIS.id }));
    }
  }

  // ---------- Legend ----------
  function legend(level, route) {
    const types = `<span class="types">${atlas.types.map((t) => `<span><i style="background:${t.color}"></i>${esc(t.label.toLowerCase())}</span>`).join("")}</span>`;
    const L = [
      `<span class="lg-title">How to read the galaxy</span><span class="lg">★ <b>Star</b> = a neighborhood</span><span class="lg"><b>Size</b> = papers</span><span class="lg"><b>Closer</b> = more papers in common</span><span class="lg"><b>Lines</b> = strongest shared-paper routes</span>`,
      route.sys === DEBRIS?.id
        ? `<span class="lg-title">Debris field</span><span class="lg"><b>Rock</b> = a concept with no shared-paper links</span><span class="lg"><b>Size</b> = papers</span>${types}`
        : `<span class="lg-title">How to read a system</span><span class="lg"><b>Star</b> = anchor concept</span><span class="lg"><b>Orbit distance</b> = how tightly it belongs (close = core)</span><span class="lg"><b>Size</b> = papers</span><span class="lg"><b>Edge tags</b> = neighboring systems</span>${types}`,
      `<span class="lg-title">How to read a concept</span><span class="lg"><b>Moons</b> = its strongest connections</span><span class="lg"><b>Closer, bigger</b> = more shared papers</span><span class="lg"><span style="color:#ffd98a">◌</span> <b>dashed ring</b> = lives in another system</span>${types}`,
      `<span class="lg-title">How to read a connection</span><span class="lg"><b>Dot</b> = one paper that studies both</span><span class="lg"><b>Left → right</b> = ${F.range[0]} → ${F.range[1]}</span><span class="lg"><b>Column height</b> = papers that year</span>`,
      `<span class="lg-title">How to read a paper</span><span class="lg">◆ <b>Center</b> = the paper</span><span class="lg"><b>Around it</b> = the concepts it studies</span><span class="lg"><b>Size</b> = that concept's papers</span>${types}`
    ];
    $("#legend").innerHTML = L[level];
  }

  // ---------- Breadcrumb ----------
  function crumbs(route, level) {
    const items = [{ lvl: "", label: "Galaxy", r: {} }];
    if (route.sys) items.push({ lvl: "system", label: shortName(sysName(atlas.clusterById.get(route.sys)), 34), r: { sys: route.sys } });
    if (route.a) items.push({ lvl: "", label: atlas.byId.get(route.a).label, r: { sys: route.sys, a: route.a } });
    if (route.b) items.push({ lvl: "", label: "↔ " + atlas.byId.get(route.b).label, r: { sys: route.sys, a: route.a, b: route.b } });
    if (route.p != null) items.push({ lvl: "", label: shortName(T.paperTitle(atlas.paperById.get(route.p)), 34), r: route });
    $("#crumbs").innerHTML = items.map((it, i) => `${i ? '<span class="sep">›</span>' : ""}<button class="${i === items.length - 1 ? "here" : ""}" data-i="${i}" title="${esc(it.label)}">${esc(it.label)}</button>`).join("");
    $("#crumbs").querySelectorAll("button").forEach((b) => { b.onclick = () => { const it = items[+b.dataset.i]; if (+b.dataset.i < items.length - 1) go(it.r); }; });
    $("#back").disabled = level === 0;
  }

  // =====================================================================
  // ROUTING + TRANSITIONS
  // =====================================================================
  function parse(hash) {
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const r = {};
    for (let i = 0; i < parts.length; i += 2) {
      const k = parts[i], v = decodeURIComponent(parts[i + 1] || "");
      if (k === "s") r.sys = v; else if (k === "c") r.a = v; else if (k === "x") r.b = v; else if (k === "p") r.p = /^\d+$/.test(v) ? +v : v;
    }
    if (r.a && !atlas.byId.has(r.a)) delete r.a;
    if (r.b && (!r.a || !atlas.byId.has(r.b))) delete r.b;
    if (r.p != null && !atlas.paperById.has(r.p)) delete r.p;
    if (r.p != null && !r.a) r.a = atlas.conceptsOfPaper(r.p)[0]?.id;
    if (r.a) r.sys = atlas.byId.get(r.a).cluster;
    if (r.sys && !atlas.clusterById.has(r.sys)) delete r.sys;
    return r;
  }
  const toHash = (r) => "#/" + [r.sys && `s/${r.sys}`, r.a && `c/${encodeURIComponent(r.a)}`, r.b && `x/${encodeURIComponent(r.b)}`, r.p != null && `p/${r.p}`].filter(Boolean).join("/");
  const levelOf = (r) => (r.p != null ? 4 : r.b ? 3 : r.a ? 2 : r.sys ? 1 : 0);
  function go(r) {
    const h = toHash(r);
    if (location.hash === h) return;
    location.hash = h;
  }
  function up() {
    const r = { ...cur.route };
    if (r.p != null) delete r.p; else if (r.b) delete r.b; else if (r.a) delete r.a; else if (r.sys) delete r.sys; else return;
    go(r);
  }

  const cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, mx: 0, my: 0 };
  let cur = { route: {}, level: -1 };
  let token = 0;

  const ZOOM_G = 6, ZOOM_S = 1.7;
  function galaxyState(level, route) {
    if (level === 0) return { t: "translate(0,0) scale(1)", o: 1 };
    const s = atlas.clusterById.get(route.sys);
    const gx = s?.gx ?? G.gcx, gy = s?.gy ?? G.gcy;
    return { t: `translate(${G.area.cx - gx * ZOOM_G},${G.area.cy - gy * ZOOM_G}) scale(${ZOOM_G})`, o: 0 };
  }
  function systemState(level, route, sysId) {
    const s = atlas.clusterById.get(sysId || route.sys);
    const A = G.area;
    if (level === 0 || !s) {
      const gx = s?.gx ?? G.gcx, gy = s?.gy ?? G.gcy, k = 0.08;
      return { t: `translate(${gx - A.cx * k},${gy - A.cy * k}) scale(${k})`, o: 0 };
    }
    if (level === 1) return { t: "translate(0,0) scale(1)", o: 1 };
    const L = G.sysL || {};
    let px = A.cx, py = A.cy;
    const p = L.byId && L.byId.get(route.a);
    if (p) { px = p.x; py = p.y; }
    return { t: `translate(${A.cx - px * ZOOM_S},${A.cy - py * ZOOM_S}) scale(${ZOOM_S})`, o: level === 2 ? 0.16 : 0.07 };
  }
  function applyLayer(g, st, dur, delay = 0) {
    g.interrupt();
    g.style("pointer-events", st.o >= 1 ? null : "none");
    if (!dur) { g.attr("transform", st.t).style("opacity", st.o); return; }
    g.transition().delay(delay).duration(dur).ease(d3.easeCubicInOut).attr("transform", st.t).style("opacity", st.o);
  }

  function showEmpty(html) { const e = $("#empty"); e.innerHTML = html; e.hidden = false; }
  function hideEmpty() { $("#empty").hidden = true; }

  function buildFocusContent(route, level) {
    const root = gFocus.append("g").attr("class", "focus-content");
    if (level === 2) buildConcept(route, root);
    else if (level === 3) buildConnection(route, root);
    else if (level === 4) buildPaper(route, root);
    return root;
  }

  function renderPanel(route, level) {
    document.body.classList.toggle("with-panel", level >= 1);
    $("#panel").classList.toggle("hidden", level === 0);
    if (level === 0) return;
    if (level === 1) panelSystem(atlas.clusterById.get(route.sys));
    else if (level === 2) panelConcept(route);
    else if (level === 3) panelConnection(route);
    else panelPaper(route);
    buildMinimap(route);
  }

  function navigate(opts = {}) {
    const route = parse(location.hash);
    const level = levelOf(route);
    const prev = cur;
    const my = ++token;
    cur = { route, level };
    const instant = !!opts.instant;
    const d = instant ? 0 : DUR;
    hideTip(); hideEmpty();
    gSys.selectAll(".hover-link").remove(); gSys.selectAll(".orbit").classed("hl", false);

    // Galaxy layer
    if (opts.rebuildGalaxy) buildGalaxy();
    // System layer
    const travel = !instant && prev.level === 1 && level === 1 && prev.route.sys && prev.route.sys !== route.sys && d;
    if (travel) {
      const from = atlas.clusterById.get(prev.route.sys), to = atlas.clusterById.get(route.sys);
      let dx = (to.u ?? (W - 190 - G.gcx) / G.k) - (from.u ?? (W - 190 - G.gcx) / G.k);
      let dy = ((to.v ?? 300) - (from.v ?? 300)) * TILT_G;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const off = Math.max(W, H) * 0.7;
      gSys.interrupt().style("pointer-events", "none")
        .transition().duration(d * 0.45).ease(d3.easeCubicIn)
        .attr("transform", `translate(${-dx * off},${-dy * off}) scale(0.85)`).style("opacity", 0)
        .on("end", () => {
          if (my !== token) return;
          buildSystem(route.sys);
          gSys.attr("transform", `translate(${dx * off},${dy * off}) scale(0.85)`).style("opacity", 0);
          applyLayer(gSys, systemState(1, route), d * 0.6);
        });
      cam.tx += dx * 260; cam.ty += dy * 260;
    } else {
      if (level >= 1 && (sysBuilt !== route.sys || opts.rebuildSystem)) {
        const fresh = sysBuilt !== route.sys;
        buildSystem(route.sys);
        if (fresh && !instant) {
          const start = prev.level <= 0 ? systemState(0, route) : { t: systemState(level, route).t, o: 0 };
          gSys.interrupt().attr("transform", start.t).style("opacity", start.o);
        }
      }
      if (level >= 1 || sysBuilt) applyLayer(gSys, systemState(level, route, sysBuilt), d, level >= 1 && prev.level === 0 ? d * 0.15 : 0);
    }
    applyLayer(gGal, galaxyState(level, route), d);
    gSys.classed("bg", level >= 2);

    // Focus layer
    const focusChanged = opts.rebuildFocus || toHash(prev.route) !== toHash(route) || prev.level !== level;
    if (focusChanged) {
      const old = gFocus.selectAll(".focus-content");
      if (d) old.interrupt().transition().duration(220).style("opacity", 0).remove(); else old.remove();
      if (level >= 2) {
        const root = buildFocusContent(route, level);
        if (d) {
          const A = G.area, s0 = prev.level < level ? 0.7 : 1.25;
          root.style("opacity", 0).attr("transform", `translate(${A.cx * (1 - s0)},${A.cy * (1 - s0)}) scale(${s0})`)
            .transition().delay(prev.level < 2 ? d * 0.55 : 160).duration(d * 0.75).ease(d3.easeCubicOut)
            .attr("transform", "translate(0,0) scale(1)").style("opacity", 1);
        }
      }
    }
    gFocus.style("pointer-events", level >= 2 ? null : "none");

    // Chrome
    $("#welcome").classList.toggle("gone", level !== 0);
    renderPanel(route, level);
    if (focusChanged && !opts.keepPanelAnim) { pb.classList.remove("enter"); void pb.offsetWidth; pb.classList.add("enter"); pb.scrollTop = 0; }
    legend(level, route);
    crumbs(route, level);
    cam.tz = [1, 1.55, 2.0, 2.15, 2.3][level];
    if (level === 0) { cam.tx = 0; cam.ty = 0; }
    if (!travel && level >= 1 && prev.level === 0) {
      const s = atlas.clusterById.get(route.sys);
      if (s) { cam.tx = (s.gx - W / 2) * 0.5; cam.ty = (s.gy - H / 2) * 0.5; }
    }
    if (RM || instant) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; }
    if (level === 0 && !ST.sys.some((s) => s.vis.length)) showEmpty(`No concepts match <b>${esc(filterDesc())}</b>. Try widening the year range or lowering the minimum.`);
    if (level === 1 && route.sys === DEBRIS?.id && !ST.debVis.length) showEmpty(`No debris concepts match <b>${esc(filterDesc())}</b>.`);
    if (level === 1 && route.sys !== DEBRIS?.id && !ST.sys[atlas.clusterById.get(route.sys).idx].vis.length) showEmpty(`No concepts in this system match <b>${esc(filterDesc())}</b>.`);
  }

  // ---------- Starfield (canvas) ----------
  const sky = $("#sky");
  const sctx = sky.getContext("2d");
  const rnd = mulberry(42);
  const stars = [];
  [[420, 0.12, 0.7], [180, 0.35, 1.1], [60, 0.75, 1.6]].forEach(([count, depth, size]) => {
    for (let i = 0; i < count; i++) stars.push({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, depth, size: size * (0.5 + rnd()), a: 0.25 + rnd() * 0.6, ph: rnd() * 6.28, sp: 0.5 + rnd() * 1.5, warm: rnd() < 0.25 });
  });
  const nebulae = [[-0.35, -0.15, 0.6, "120,90,200"], [0.4, 0.25, 0.5, "60,120,200"], [0.05, 0.4, 0.45, "200,140,80"], [-0.6, 0.45, 0.35, "80,160,180"]];
  let nebCanvas = null;
  function renderNebula() {
    nebCanvas = document.createElement("canvas");
    const nw = Math.round(W * 1.4), nh = Math.round(H * 1.4);
    nebCanvas.width = nw; nebCanvas.height = nh;
    const c = nebCanvas.getContext("2d");
    nebulae.forEach(([nx, ny, nr, rgb]) => {
      const x = nw / 2 + nx * W * 0.6, y = nh / 2 + ny * H * 0.6, r = nr * Math.max(W, H);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},0.075)`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.fillRect(0, 0, nw, nh);
    });
  }
  function drawSky(t) {
    const ease = RM ? 1 : 0.055;
    cam.x += (cam.tx - cam.x) * ease; cam.y += (cam.ty - cam.y) * ease; cam.z += (cam.tz - cam.z) * ease;
    const dpr = devicePixelRatio;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.fillStyle = "#07080d"; sctx.fillRect(0, 0, W, H);
    if (!nebCanvas || nebCanvas.width !== Math.round(W * 1.4)) renderNebula();
    {
      const z = 1 + (cam.z - 1) * 0.15;
      const nw = nebCanvas.width * z, nh = nebCanvas.height * z;
      sctx.drawImage(nebCanvas, W / 2 - nw / 2 - (cam.x * 0.1 + cam.mx * 6) * z, H / 2 - nh / 2 - (cam.y * 0.1 + cam.my * 6) * z, nw, nh);
    }
    for (const s of stars) {
      const z = 1 + (cam.z - 1) * s.depth;
      const x = W / 2 + (s.x * W * 0.75 - cam.x * s.depth - cam.mx * 18 * s.depth) * z;
      const y = H / 2 + (s.y * H * 0.75 - cam.y * s.depth - cam.my * 14 * s.depth) * z;
      if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
      const a = RM ? s.a : s.a * (0.65 + 0.35 * Math.sin(t * 0.001 * s.sp + s.ph));
      sctx.fillStyle = s.warm ? `rgba(255,226,180,${a})` : `rgba(215,225,255,${a})`;
      const sz = s.size * Math.min(2.2, z);
      sctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    requestAnimationFrame(drawSky);
  }
  window.addEventListener("mousemove", (ev) => {
    cam.mx = ev.clientX / W - 0.5; cam.my = ev.clientY / H - 0.5;
    if (cur.level === 0 && !RM) gGal.select(".par").attr("transform", `translate(${-cam.mx * 10},${-cam.my * 7})`);
  });

  // ---------- Filters UI ----------
  const fbtn = $("#filters-btn"), fpop = $("#filters"), apop = $("#about");
  function togglePop(pop, btn, show) {
    const on = show ?? pop.hidden;
    [fpop, apop].forEach((p) => { if (p !== pop) p.hidden = true; });
    fbtn.setAttribute("aria-expanded", "false");
    pop.hidden = !on;
    if (btn) btn.setAttribute("aria-expanded", String(on));
  }
  fbtn.onclick = (e) => { e.stopPropagation(); togglePop(fpop, fbtn); };
  $("#about-btn").onclick = (e) => { e.stopPropagation(); togglePop(apop, null); };
  document.addEventListener("click", (e) => {
    if (!fpop.contains(e.target) && e.target !== fbtn) fpop.hidden = true, fbtn.setAttribute("aria-expanded", "false");
    if (!apop.contains(e.target)) apop.hidden = true;
    if (!$(".search-wrap").contains(e.target)) $("#search-results").hidden = true;
  });
  const y0i = $("#y0"), y1i = $("#y1"), minp = $("#minp");
  [y0i, y1i].forEach((i) => { i.min = atlas.Y0; i.max = atlas.Y1; i.step = 1; });
  function syncFilterUI() {
    $("#type-chips").innerHTML = atlas.types.map((t) => `<button class="chip${F.types.has(t.id) ? "" : " off"}" data-t="${t.id}" style="color:${t.color}"><span class="dot" style="background:${t.color}"></span><span style="color:var(--text)">${esc(t.plural)}</span><span class="n">${t.count}</span></button>`).join("");
    $("#type-chips").querySelectorAll(".chip").forEach((c) => { c.onclick = () => { F.types.has(c.dataset.t) ? F.types.delete(c.dataset.t) : F.types.add(c.dataset.t); applyFilters(); }; });
    y0i.value = F.range[0]; y1i.value = F.range[1]; minp.value = F.minPapers;
    $("#year-label").textContent = rangeText();
    $("#min-label").textContent = F.minPapers <= 1 ? "any" : `≥ ${F.minPapers}`;
    const active = (atlas.rangeActive(F) ? 1 : 0) + (F.minPapers > 1 ? 1 : 0) + (F.types.size < atlas.types.length ? 1 : 0);
    $("#filter-count").textContent = active ? active : "";
    $("#filter-summary").textContent = `${ST.papersInRange} papers · ${atlas.nodes.filter((m) => atlas.nodeVisible(m, F)).length} concepts`;
    // corpus histogram
    const hs = d3.select("#year-hist"), counts = yearCounts(atlas.papers), mx = d3.max(counts), bw = 300 / counts.length;
    hs.selectAll("*").remove();
    counts.forEach((c, i) => {
      const y = atlas.Y0 + i, inR = y >= F.range[0] && y <= F.range[1];
      hs.append("rect").attr("x", i * bw + 0.5).attr("y", 34 - (c / mx) * 32).attr("width", bw - 1.5).attr("height", Math.max(1, (c / mx) * 32)).attr("rx", 1).attr("fill", inR ? "#ffd98a" : "#2a2f3c");
    });
  }
  let ftimer = null;
  function applyFilters(debounce) {
    computeStats();
    syncFilterUI();
    clearTimeout(ftimer);
    ftimer = setTimeout(() => navigate({ instant: true, rebuildGalaxy: true, rebuildSystem: true, rebuildFocus: true, keepPanelAnim: true }), debounce ? 60 : 0);
  }
  y0i.oninput = () => { let a = +y0i.value; if (a > F.range[1]) a = F.range[1]; F.range = [a, F.range[1]]; applyFilters(true); };
  y1i.oninput = () => { let b = +y1i.value; if (b < F.range[0]) b = F.range[0]; F.range = [F.range[0], b]; applyFilters(true); };
  minp.oninput = () => { F.minPapers = +minp.value; applyFilters(true); };
  $("#filters-clear").onclick = () => { F = atlas.defaultFilter(); applyFilters(); };
  $("#reset").onclick = () => { F = atlas.defaultFilter(); computeStats(); syncFilterUI(); fpop.hidden = true; if (location.hash !== "#/") { buildGalaxy(); go({}); } else navigate({ rebuildGalaxy: true, rebuildFocus: true }); };
  $("#back").onclick = up;

  // ---------- Search ----------
  const sIn = $("#search"), sRes = $("#search-results");
  let sItems = [], sAct = 0;
  function renderSearch() {
    const q = sIn.value;
    sItems = atlas.search(q, 8);
    if (!q.trim()) { sRes.hidden = true; return; }
    sRes.hidden = false;
    sRes.innerHTML = sItems.length ? sItems.map((m, i) => {
      const hidden = !atlas.nodeVisible(m, F);
      const c = atlas.clusterById.get(m.cluster);
      return `<div class="sr-item${i === sAct ? " active" : ""}" data-i="${i}" role="option"><span class="dot" style="background:${atlas.colorOf(m.type)}"></span><span class="lbl">${esc(m.label)}<span class="sys">${c.unlinked ? "drifting debris" : "in " + esc(shortName(sysName(c), 34))}${hidden ? " · hidden by filters" : ""}</span></span><span class="n">${m.paperCount}</span></div>`;
    }).join("") : `<div class="sr-empty">No concept matches “${esc(q)}”.</div>`;
    sRes.querySelectorAll(".sr-item").forEach((el) => {
      el.onmousedown = (e) => { e.preventDefault(); pick(+el.dataset.i); };
      el.onmouseenter = () => { sAct = +el.dataset.i; sRes.querySelectorAll(".sr-item").forEach((x, i) => x.classList.toggle("active", i === sAct)); };
    });
  }
  function pick(i) {
    const m = sItems[i]; if (!m) return;
    sIn.value = ""; sRes.hidden = true; sIn.blur();
    go({ sys: m.cluster, a: m.id });
  }
  sIn.addEventListener("input", () => { sAct = 0; renderSearch(); });
  sIn.addEventListener("focus", renderSearch);
  sIn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sAct = Math.min(sItems.length - 1, sAct + 1); renderSearch(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sAct = Math.max(0, sAct - 1); renderSearch(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(sAct); }
    else if (e.key === "Escape") { sIn.value = ""; sRes.hidden = true; sIn.blur(); e.stopPropagation(); }
  });
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.key === "Escape") {
      if (!fpop.hidden || !apop.hidden) { fpop.hidden = true; apop.hidden = true; return; }
      if (!typing) up();
    } else if (e.key === "/" && !typing) { e.preventDefault(); sIn.focus(); }
  });

  // ---------- Boot ----------
  geom();
  buildDefs();
  legend(0, {});
  buildGalaxy();
  syncFilterUI();
  window.addEventListener("hashchange", () => navigate());
  let rz = null;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => { geom(); sysBuilt = null; navigate({ instant: true, rebuildGalaxy: true, rebuildFocus: true, keepPanelAnim: true }); }, 120);
  });
  navigate();
  requestAnimationFrame(drawSky);
  $("#loading").classList.add("done");
  window.__atlas = atlas;
})();
