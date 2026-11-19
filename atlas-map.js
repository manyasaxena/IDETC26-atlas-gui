// Shared by the Map view (redesign-v2.html) and the terrain (terrain-v2.html), so both place concepts the same way.
// Four "Group by" modes; each gives groups (the shaded regions) and a position for every concept.
//   type      the four concept types, one region each
//   together  neighborhoods of concepts that share many papers (Louvain, from map_groups.json)
//   meaning   concepts whose definitions use similar words (TF-IDF + MDS, from map_groups.json)
//   families  suggested topic families within each type (suggested_groups.json, for review)
// Layouts are deterministic: the same data always gives the same map. Needs d3 v7.
(function () {
  const W = 1000, H = 700;
  // The plain words for reading the map: used by the home page, every legend in the Atlas, and the terrain.
  const WORDS = {
    dot: ["Dot", "a concept"],
    size: ["Size", "number of papers"],
    color: ["Color", "concept type"],
    // Lines all look the same; strength shows only when you hover (or select) a dot.
    line: ["Line", "studied in the same papers. Hover a dot to see how strong its links are."],
    // The home page's version: same claim, pointing to where you can hover.
    lineHome: ["Line", "studied in the same papers. Hover a dot in the network to see how many."],
    close: ["Closer", "roughly, studied together more often"],
    // Matches updateOrbit(): neighbors ranked by overlap (shared ÷ papers with either), split into thirds.
    rings: ["Rings", "how much a concept’s papers overlap with the center’s (shared papers ÷ papers with either one). The top third sits on the inner ring"],
    caveat: "A line means “studied together,” not “proven related.”"
  };

  const MODES = [
    { key: "type", label: "Type", line: "Type: concepts sit in four regions, one for each kind of concept." },
    { key: "together", label: "Studied together", line: "Studied together: neighborhoods of concepts that share many papers." },
    { key: "meaning", label: "Similar meaning", line: "Similar meaning: concepts whose definitions use similar words sit close together." },
    { key: "families", label: "Topic families", line: "Topic families: suggested groups within each type (suggestions, not yet reviewed)." }
  ];
  // What position means in each mode, matching what layout() below does.
  const POSITION = {
    type: "Position only separates the four types.",
    together: "Each neighborhood shares many papers. Within one, closer = roughly, studied together more often.",
    meaning: "Groups with similar wording sit near each other; within a group, closer = roughly, more similar words in their definitions.",
    families: "Position only separates the groups. Families of the same type sit side by side."
  };

  // nodes: [{ id, label, type, paperCount }] (placeholders already removed)
  // links: [{ a, b, shared }] between different types
  // files: { groups: map_groups.json, suggested: suggested_groups.json }, typeOrder: ["subject", ...], typeLabel(t)
  function build({ nodes, links, files, typeOrder, typeLabel }) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const byLabel = new Map(nodes.map((n) => [`${n.type}|${n.label}`, n]));
    const r = d3.scaleSqrt().domain([0, d3.max(nodes, (n) => n.paperCount) || 1]).range([3.5, 26]);
    const radius = (n) => r(n.paperCount);
    const keep = (ids) => ids.filter((id) => byId.has(id));

    const groupsFor = {
      type: () => typeOrder.map((t) => ({ id: `type-${t}`, name: typeLabel(t), type: t, members: nodes.filter((n) => n.type === t).map((n) => n.id) })),
      together: () => files.groups.modes.together.groups.map((g) => ({ id: g.id, name: g.name, members: keep(g.members), loose: g.name.startsWith("No shared papers") })),
      meaning: () => files.groups.modes.meaning.groups.map((g) => ({ id: g.id, name: g.name, members: keep(g.members) })),
      families: () => {
        const out = [];
        typeOrder.forEach((t) => {
          const placed = new Set();
          (files.suggested.types[t] || []).forEach((g, i) => {
            const ms = g.members.map((label) => byLabel.get(`${t}|${label}`)).filter(Boolean).map((n) => n.id);
            ms.forEach((id) => placed.add(id));
            if (ms.length) out.push({ id: `fam-${t}-${i}`, name: g.name, type: t, members: ms });
          });
          const rest = nodes.filter((n) => n.type === t && !placed.has(n.id)).map((n) => n.id);
          if (rest.length) out.push({ id: `fam-${t}-other`, name: `Other ${typeLabel(t).toLowerCase()}`, type: t, members: rest });
        });
        return out;
      }
    };

    // Group circles packed without overlap (families nest inside their type), then concepts settled inside them.
    function layout(mode) {
      const groups = groupsFor[mode]().filter((g) => g.members.length);
      const groupOf = new Map();
      groups.forEach((g) => g.members.forEach((id) => groupOf.set(id, g)));
      const area = (g) => d3.sum(g.members, (id) => (radius(byId.get(id)) + 7) ** 2) * 1.9;
      const pos = new Map();

      // Group circles: packed without overlap (families nest inside their type). For "meaning", each group's circle
      // starts where its concepts sit in the definition-similarity layout (MDS) and is only pushed apart enough
      // not to overlap, so groups with similar wording stay near each other.
      const C = mode === "meaning" ? files.groups.modes.meaning.coords : null;
      if (C) {
        const sx = d3.scaleLinear().domain(d3.extent(nodes, (n) => C[n.id]?.[0] ?? 0)).range([0, W]);
        const sy = d3.scaleLinear().domain(d3.extent(nodes, (n) => C[n.id]?.[1] ?? 0)).range([0, H]);
        const total = d3.sum(groups, area);
        const k = Math.sqrt((W * H * 0.42) / (Math.PI * total));
        groups.forEach((g) => {
          g.mx = d3.mean(g.members, (id) => sx(C[id]?.[0] ?? 0));
          g.my = d3.mean(g.members, (id) => sy(C[id]?.[1] ?? 0));
          g.cr = Math.sqrt(area(g)) * k;
          g.x = g.mx; g.y = g.my;
        });
        const gs = d3.forceSimulation(groups).stop()
          .force("x", d3.forceX((g) => g.mx).strength(0.05)).force("y", d3.forceY((g) => g.my).strength(0.05))
          .force("collide", d3.forceCollide((g) => g.cr + 22).iterations(3));
        for (let i = 0; i < 300; i++) gs.tick();
        // Fit the group circles back into the canvas.
        const x0 = d3.min(groups, (g) => g.x - g.cr), x1 = d3.max(groups, (g) => g.x + g.cr);
        const y0 = d3.min(groups, (g) => g.y - g.cr), y1 = d3.max(groups, (g) => g.y + g.cr);
        const f = Math.min((W - 40) / (x1 - x0), (H - 40) / (y1 - y0));
        groups.forEach((g) => { g.cx = 20 + (g.x - x0) * f; g.cy = 20 + (g.y - y0) * f; g.cr *= f; });
      } else {
        const root = mode === "families"
          ? { children: typeOrder.map((t) => ({ children: groups.filter((g) => g.type === t).map((g) => ({ g, value: area(g) })) })).filter((c) => c.children.length) }
          : { children: groups.map((g) => ({ g, value: area(g) })) };
        const packed = d3.pack().size([W, H]).padding((d) => (d.depth === 0 ? 34 : 18))(d3.hierarchy(root).sum((d) => d.value || 0).sort((a, b) => b.value - a.value));
        packed.leaves().forEach((leaf) => { leaf.data.g.cx = leaf.x; leaf.data.g.cy = leaf.y; leaf.data.g.cr = leaf.r; });
      }

      // Concepts inside their group's circle. "meaning": each keeps its place relative to the group's other members
      // in the similarity layout; "together": shared papers pull concepts closer; otherwise they just settle.
      const sim = nodes.map((n) => {
        const g = groupOf.get(n.id);
        let tx = g.cx, ty = g.cy;
        if (C) {
          const spread = d3.max(g.members, (id) => Math.hypot((C[id]?.[0] ?? 0) - (C[n.id]?.[0] ?? 0), (C[id]?.[1] ?? 0) - (C[n.id]?.[1] ?? 0))) || 1;
          const mx = d3.mean(g.members, (id) => C[id]?.[0] ?? 0), my = d3.mean(g.members, (id) => C[id]?.[1] ?? 0);
          const sc = (g.cr * 0.8) / Math.max(spread, 1e-6);
          tx = g.cx + ((C[n.id]?.[0] ?? 0) - mx) * sc * 0.7;
          ty = g.cy + ((C[n.id]?.[1] ?? 0) - my) * sc * 0.7;
        }
        return { id: n.id, g, r: radius(n), tx, ty, x: tx + (Math.cos(n.paperCount * 7.1 + n.label.length) * g.cr) / 4, y: ty + (Math.sin(n.paperCount * 3.3 + n.label.length) * g.cr) / 4 };
      });
      const index = new Map(sim.map((d) => [d.id, d]));
      const inside = links.filter((l) => index.get(l.a)?.g === index.get(l.b)?.g).map((l) => ({ source: l.a, target: l.b, shared: l.shared }));
      const maxShared = d3.max(inside, (l) => l.shared) || 1;
      const s = d3.forceSimulation(sim).stop()
        .force("x", d3.forceX((d) => d.tx).strength(C ? 0.2 : 0.09))
        .force("y", d3.forceY((d) => d.ty).strength(C ? 0.2 : 0.09))
        .force("collide", d3.forceCollide((d) => d.r + 4).iterations(2));
      if (mode === "together") s.force("link", d3.forceLink(inside).id((d) => d.id).distance((l) => 70 - 45 * (l.shared / maxShared)).strength(0.08));
      for (let i = 0; i < 320; i++) {
        s.tick();
        // Keep each concept inside its group's circle.
        sim.forEach((d) => {
          const dx = d.x - d.g.cx, dy = d.y - d.g.cy, lim = Math.max(4, d.g.cr - d.r - 4), dist = Math.hypot(dx, dy);
          if (dist > lim) { d.x = d.g.cx + (dx / dist) * lim; d.y = d.g.cy + (dy / dist) * lim; }
        });
      }
      sim.forEach((d) => pos.set(d.id, [d.x, d.y]));

      // Each group's soft region: a smoothed outline around its concepts, padded.
      groups.forEach((g) => {
        const pts = [];
        g.members.forEach((id) => {
          const [x, y] = pos.get(id), pad = radius(byId.get(id)) + 20;
          for (let k = 0; k < 10; k++) pts.push([x + pad * Math.cos((k / 10) * 2 * Math.PI), y + pad * Math.sin((k / 10) * 2 * Math.PI)]);
        });
        g.hull = d3.polygonHull(pts) || pts;
        g.centroid = d3.polygonCentroid(g.hull);
        const ys = g.hull.map((p) => p[1]);
        g.top = d3.min(ys);
        g.papers = d3.sum(g.members, (id) => byId.get(id).paperCount);
        g.biggest = g.members.slice().sort((a, b) => byId.get(b).paperCount - byId.get(a).paperCount);
      });
      return { mode, groups, pos, groupOf };
    }

    const cache = new Map();
    return {
      W, H, MODES, POSITION, radius,
      layout: (mode) => { if (!cache.has(mode)) cache.set(mode, layout(mode)); return cache.get(mode); },
      // A smooth closed path for a region outline, in layout units.
      regionPath: (hull, tx = (p) => p) => d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6))(hull.map(tx))
    };
  }

  window.AtlasMap = { build, MODES, POSITION, WORDS, W, H };
})();
