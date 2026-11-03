// Shared data layer for the Atlas variations. No rendering and no dependencies: every concept page
// loads this, calls `await AtlasCore.load()` and builds its own views on top of the returned object.
// The data preparation follows redesign.html (deduplicated edges, shared counts from the paper lists,
// schema-driven types and connection sentences) so all four concepts tell the same story about the data.
(function (root) {
  "use strict";

  const SPARE_COLORS = ["#f48fb1", "#80cbc4", "#fff176", "#9fa8da", "#ffab91", "#c5e1a5", "#b0bec5"];

  // ---------- Text helpers ----------
  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const withArticle = (s) => `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;
  function listJoin(items) {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }
  function fillTemplate(template, vars) {
    return template.replace(/\{(a )?(\w+)\}/g, (match, article, key) => {
      if (!(key in vars)) return match;
      return article ? withArticle(vars[key]) : vars[key];
    });
  }

  // Most titles in the data are in all caps; those get title case, everything else is left alone.
  const SMALL_WORDS = new Set("a an and as at but by for from in into nor of on onto or per than the to via vs with within without".split(" "));
  const ACRONYMS = new Map("AI CAD CAE CFD DDC EEG ECG FEA FMEA FMRI FNIRS GPT HCI HRV IOT LLM ML NASA NLP PSS QFD STEM TRIZ UI UX VR AR XR MBSE AHP AUT II III IV".split(" ").map((w) => [w, w]));
  [["LLMS", "LLMs"], ["IOT", "IoT"], ["FMRI", "fMRI"], ["FNIRS", "fNIRS"], ["AIS", "AIs"]].forEach(([k, v]) => ACRONYMS.set(k, v));
  function titleCase(title) {
    const t = (title || "").trim();
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (!letters || letters.replace(/[^A-Z]/g, "").length / letters.length < 0.7) return t;
    let forceCap = true;
    return t.replace(/[A-Za-z0-9][A-Za-z0-9'’]*|[^A-Za-z0-9]+/g, (token) => {
      if (!/[A-Za-z0-9]/.test(token[0])) {
        if (/[:?!—–]/.test(token)) forceCap = true;
        return token;
      }
      const upper = token.toUpperCase();
      const first = forceCap;
      forceCap = false;
      if (ACRONYMS.has(upper)) return ACRONYMS.get(upper);
      if (/^\d+[A-Z]$/.test(upper)) return upper;
      const lower = token.toLowerCase();
      if (!first && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
  }
  const paperTitle = (p) => titleCase(p.title) || "[title unavailable]";

  // ---------- Neighborhoods ----------
  // Louvain community detection (one level of moves, then aggregation, repeated). Seeded so every
  // page load and every concept gets the same neighborhoods.
  function louvain(nodeIds, weightedEdges, resolution, seed) {
    let rand = seed >>> 0 || 1;
    const rnd = () => ((rand = (rand * 1664525 + 1013904223) >>> 0) / 4294967296);
    let comm = new Map(nodeIds.map((id) => [id, id]));
    let graphNodes = nodeIds.slice();
    let graphEdges = weightedEdges.map(([a, b, w]) => [a, b, w]);
    let membership = new Map(nodeIds.map((id) => [id, id]));
    for (let level = 0; level < 10; level++) {
      const adj = new Map(graphNodes.map((n) => [n, new Map()]));
      const deg = new Map(graphNodes.map((n) => [n, 0]));
      let m2 = 0;
      graphEdges.forEach(([a, b, w]) => {
        adj.get(a).set(b, (adj.get(a).get(b) || 0) + w);
        adj.get(b).set(a, (adj.get(b).get(a) || 0) + w);
        deg.set(a, deg.get(a) + w);
        deg.set(b, deg.get(b) + w);
        m2 += 2 * w;
      });
      if (!m2) break;
      const c = new Map(graphNodes.map((n) => [n, n]));
      const tot = new Map(graphNodes.map((n) => [n, deg.get(n)]));
      let moved = true, anyMove = false, passes = 0;
      while (moved && passes++ < 50) {
        moved = false;
        // Seeded Fisher–Yates; a random sort comparator gives different orders in different engines.
        const order = graphNodes.slice();
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (const n of order) {
          const own = c.get(n), k = deg.get(n);
          const links = new Map();
          adj.get(n).forEach((w, nb) => { if (nb !== n) links.set(c.get(nb), (links.get(c.get(nb)) || 0) + w); });
          tot.set(own, tot.get(own) - k);
          let best = own, bestGain = (links.get(own) || 0) - (resolution * tot.get(own) * k) / m2;
          links.forEach((w, cc) => {
            const gain = w - (resolution * tot.get(cc) * k) / m2;
            if (gain > bestGain + 1e-12) { best = cc; bestGain = gain; }
          });
          tot.set(best, tot.get(best) + k);
          if (best !== own) { c.set(n, best); moved = true; anyMove = true; }
        }
      }
      if (!anyMove) break;
      membership = new Map([...membership].map(([id, g]) => [id, c.get(g)]));
      const pairW = new Map();
      graphEdges.forEach(([a, b, w]) => {
        const ca = c.get(a), cb = c.get(b);
        const key = ca < cb ? `${ca}\u0000${cb}` : `${cb}\u0000${ca}`;
        pairW.set(key, (pairW.get(key) || 0) + w);
      });
      graphNodes = [...new Set(c.values())];
      graphEdges = [...pairW].map(([key, w]) => { const [a, b] = key.split("\u0000"); return [a, b, w]; });
    }
    comm = membership;
    return comm;
  }

  // ---------- Build ----------
  function build(raw, schemaFile) {
    const nodes = raw.nodes.map((n) => ({
      id: String(n.id),
      label: n.label,
      type: n.type,
      description: (n.description || "").trim(),
      papers: n.papers || [],
      paperCount: (n.papers || []).length,
      firstYear: Number(n.first_year) || null
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // Types: flat list in schema order; types used by nodes but missing from the schema still work.
    const schema = raw.schema || schemaFile || {};
    const types = [];
    const typeById = new Map();
    const spare = SPARE_COLORS.slice();
    const addType = (t) => { types.push(t); typeById.set(t.id, t); };
    (schema.types || []).forEach((t) => addType({
      id: String(t.id),
      label: t.label || cap(String(t.id)),
      plural: t.plural || t.label || cap(String(t.id)),
      color: t.color || null,
      definition: (t.definition || "").trim(),
      summary: t.summary || null,
      parentId: t.parent != null ? String(t.parent) : null
    }));
    nodes.forEach((n) => {
      if (!typeById.has(n.type)) addType({ id: n.type, label: cap(n.type), plural: cap(n.type) + "s", color: null, definition: "", summary: null, parentId: null });
    });
    types.forEach((t) => { t.count = nodes.filter((n) => n.type === t.id).length; });
    types.forEach((t) => { if (!t.color) t.color = (t.parentId && typeById.get(t.parentId)?.color) || spare.shift() || "#9aa2b2"; });
    const nodeTypes = types.filter((t) => t.count > 0);
    const typeRank = (id) => { const i = types.findIndex((t) => t.id === id); return i < 0 ? Infinity : i; };
    const colorOf = (id) => typeById.get(id)?.color || "#9aa2b2";
    const typeOf = (id) => typeById.get(id);
    const ancestry = (id) => {
      const chain = [];
      for (let t = typeById.get(id); t && chain.length < 32; t = t.parentId && typeById.get(t.parentId)) chain.push(t);
      return chain;
    };

    // Papers, and which concepts each paper covers.
    const paperById = new Map();
    const conceptsByPaper = new Map();
    nodes.forEach((n) => {
      n.papers.forEach((p) => {
        if (!paperById.has(p.paper_id)) paperById.set(p.paper_id, { ...p });
        if (!conceptsByPaper.has(p.paper_id)) conceptsByPaper.set(p.paper_id, []);
        conceptsByPaper.get(p.paper_id).push(n.id);
      });
    });
    conceptsByPaper.forEach((ids) => ids.sort((a, b) => typeRank(byId.get(a).type) - typeRank(byId.get(b).type) || byId.get(a).label.localeCompare(byId.get(b).label)));
    const papers = [...paperById.values()];

    // Some node pairs appear more than once in the edge list with identical papers; keep one.
    // The edge `weight` field is not always the paper count, so `shared` comes from the paper list.
    const linkByPair = new Map();
    const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    raw.edges.forEach((e) => {
      const a = String(e.source), b = String(e.target);
      if (a === b || !byId.has(a) || !byId.has(b)) return;
      const key = pairKey(a, b);
      if (linkByPair.has(key)) return;
      linkByPair.set(key, { key, a, b, papers: e.papers || [], shared: (e.papers || []).length });
    });
    const links = [...linkByPair.values()];
    const adjacency = new Map(nodes.map((n) => [n.id, []]));
    links.forEach((l) => {
      adjacency.get(l.a).push({ id: l.b, link: l });
      adjacency.get(l.b).push({ id: l.a, link: l });
    });
    const linkBetween = (a, b) => linkByPair.get(pairKey(a, b)) || null;
    const other = (link, id) => (link.a === id ? link.b : link.a);

    const years = papers.map((p) => p.year).filter(Boolean);
    const [Y0, Y1] = (raw.meta && raw.meta.year_range) || [Math.min(...years), Math.max(...years)];

    // Per-concept yearly paper counts and simple trend measures.
    nodes.forEach((n) => {
      const counts = new Array(Y1 - Y0 + 1).fill(0);
      n.papers.forEach((p) => { if (p.year >= Y0 && p.year <= Y1) counts[p.year - Y0] += 1; });
      n.yearCounts = counts;
      const ys = n.papers.map((p) => p.year).sort((a, b) => a - b);
      n.medianYear = ys.length ? ys[Math.floor(ys.length / 2)] : null;
      n.lastYear = ys.length ? ys[ys.length - 1] : null;
      // Share of the concept's papers from the last ten years, against the corpus-wide share.
      n.recentShare = ys.length ? ys.filter((y) => y > Y1 - 10).length / ys.length : 0;
      n.degree = adjacency.get(n.id).length;
    });
    const corpusRecentShare = years.filter((y) => y > Y1 - 10).length / years.length;

    // ---------- Neighborhoods: groups of concepts that tend to be studied together ----------
    // Edge strength is cosine similarity (shared / sqrt(papersA * papersB)) so the giant hubs
    // ("Engineering Students", "no design object") don't swallow everything. Pairs sharing a single
    // paper are left out of the grouping as noise.
    const clusterEdges = links
      .filter((l) => l.shared >= 2)
      .map((l) => [l.a, l.b, l.shared / Math.sqrt(byId.get(l.a).paperCount * byId.get(l.b).paperCount)]);
    const membership = louvain(nodes.filter((n) => adjacency.get(n.id).length).map((n) => n.id), clusterEdges, 1.6, 7);
    const groups = new Map();
    // Concepts with no connections at all (one-paper concepts, and the two catch-alls that
    // export_graph.py deliberately leaves unlinked) form their own, explicitly flagged group.
    const unlinked = nodes.filter((n) => !adjacency.get(n.id).length);
    nodes.filter((n) => adjacency.get(n.id).length).forEach((n) => {
      const g = membership.get(n.id);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    });
    // Groups of fewer than 4 concepts join the group they share the most papers with.
    const big = [...groups.values()].filter((g) => g.length >= 4);
    const bigOf = new Map();
    big.forEach((g, i) => g.forEach((n) => bigOf.set(n.id, i)));
    [...groups.values()].filter((g) => g.length < 4).flat().forEach((n) => {
      const score = new Array(big.length).fill(0);
      adjacency.get(n.id).forEach(({ id, link }) => { if (bigOf.has(id)) score[bigOf.get(id)] += link.shared / Math.sqrt(byId.get(id).paperCount); });
      const best = score.indexOf(Math.max(...score));
      if (best >= 0 && score[best] > 0) { big[best].push(n); bigOf.set(n.id, best); }
      else { big.push([n]); bigOf.set(n.id, big.length - 1); }
    });
    // Strength of a concept inside its group: summed cosine to the other members.
    const cos = (l) => l.shared / Math.sqrt(byId.get(l.a).paperCount * byId.get(l.b).paperCount);
    const clusters = big.map((members, i) => {
      const ids = new Set(members.map((n) => n.id));
      members.forEach((n) => {
        n.clusterStrength = adjacency.get(n.id).reduce((s, { id, link }) => s + (ids.has(id) ? cos(link) : 0), 0);
      });
      const paperIds = new Set(members.flatMap((n) => n.papers.map((p) => p.paper_id)));
      // Named after its two most central concepts of different types.
      const ranked = members.slice().sort((a, b) => b.clusterStrength * Math.sqrt(b.paperCount) - a.clusterStrength * Math.sqrt(a.paperCount));
      const anchor = ranked[0];
      const second = ranked.find((n) => n.type !== anchor.type) || ranked[1];
      return {
        id: `c${i}`,
        anchor,
        name: second ? `${cap(anchor.label)} & ${second.label}` : cap(anchor.label),
        members: ranked,
        paperIds,
        paperCount: paperIds.size
      };
    }).sort((a, b) => b.paperCount - a.paperCount);
    if (unlinked.length) {
      unlinked.forEach((n) => { n.clusterStrength = 0; });
      clusters.push({
        id: "",
        anchor: unlinked.slice().sort((a, b) => b.paperCount - a.paperCount)[0],
        name: "Not linked to other concepts",
        unlinked: true,
        members: unlinked.slice().sort((a, b) => b.paperCount - a.paperCount),
        paperIds: new Set(unlinked.flatMap((n) => n.papers.map((p) => p.paper_id))),
        paperCount: new Set(unlinked.flatMap((n) => n.papers.map((p) => p.paper_id))).size
      });
    }
    clusters.forEach((c, i) => { c.id = `c${i}`; c.members.forEach((n) => { n.cluster = c.id; }); });
    const clusterById = new Map(clusters.map((c) => [c.id, c]));

    // ---------- Filters ----------
    // filter = { types: Set|null, range: [y0, y1]|null, minPapers: number, query: string }
    const defaultFilter = () => ({ types: new Set(nodeTypes.map((t) => t.id)), range: [Y0, Y1], minPapers: 1, query: "" });
    const rangeActive = (f) => !!f && !!f.range && (f.range[0] > Y0 || f.range[1] < Y1);
    const inRange = (p, f) => !rangeActive(f) || (p.year >= f.range[0] && p.year <= f.range[1]);
    const papersIn = (list, f) => (rangeActive(f) ? list.filter((p) => inRange(p, f)) : list);
    // Papers of a concept or link that fall inside the year range.
    const countOf = (item, f) => papersIn(item.papers, f).length;
    const nodeVisible = (n, f) => (!f || ((!f.types || f.types.has(n.type)) && countOf(n, f) >= (f.minPapers || 1)));
    const linkVisible = (l, f, minShared = 1) => nodeVisible(byId.get(l.a), f) && nodeVisible(byId.get(l.b), f) && countOf(l, f) >= minShared;
    const neighbors = (id, f) => adjacency.get(id)
      .filter(({ id: nb, link }) => nodeVisible(byId.get(nb), f) && countOf(link, f) > 0)
      .map(({ id: nb, link }) => ({ node: byId.get(nb), link, shared: countOf(link, f) }))
      .sort((a, b) => b.shared - a.shared || a.node.label.localeCompare(b.node.label));

    // ---------- Search ----------
    function search(query, limit = 8, f = null) {
      const q = (query || "").trim().toLowerCase();
      if (!q) return [];
      const words = q.split(/\s+/);
      return nodes
        .filter((n) => !f || nodeVisible(n, { ...f, minPapers: 1 }))
        .map((n) => {
          const label = n.label.toLowerCase();
          let score = -1;
          if (label === q) score = 100;
          else if (label.startsWith(q)) score = 80;
          else if (label.split(/[\s-]+/).some((w) => w.startsWith(q))) score = 60;
          else if (label.includes(q)) score = 40;
          else if (words.every((w) => label.includes(w))) score = 30;
          else if (words.every((w) => n.description.toLowerCase().includes(w))) score = 10;
          return { n, score };
        })
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score || b.n.paperCount - a.n.paperCount)
        .slice(0, limit)
        .map((r) => r.n);
    }

    // ---------- Language ----------
    const SENTENCES = schema.connectionSentences || {};
    // "12 papers observed Engineering Students during a concept generation task"
    function connectionSentence(aNode, bNode, n) {
      const [x, y] = typeRank(aNode.type) <= typeRank(bNode.type) ? [aNode, bNode] : [bNode, aNode];
      let template = null;
      for (const tx of ancestry(x.type)) {
        for (const ty of ancestry(y.type)) {
          template = SENTENCES[`${tx.id}+${ty.id}`] || null;
          if (template) break;
        }
        if (template) break;
      }
      template = template || SENTENCES.default || "{n} studied both {A} and {B}";
      return fillTemplate(template, { n: plural(n, "paper"), A: x.label, B: y.label });
    }

    // Why two concepts are connected, as structured facts a page can phrase or render however it likes.
    function explainConnection(aId, bId, f = null) {
      const a = byId.get(aId), b = byId.get(bId);
      const link = linkBetween(aId, bId);
      const shared = link ? papersIn(link.papers, f).slice().sort((p, q) => q.year - p.year) : [];
      const n = shared.length;
      const counts = new Map();
      shared.forEach((p) => (conceptsByPaper.get(p.paper_id) || []).forEach((id) => {
        if (id !== aId && id !== bId) counts.set(id, (counts.get(id) || 0) + 1);
      }));
      const alongside = [...counts.entries()]
        .sort((x, y) => y[1] - x[1] || byId.get(x[0]).label.localeCompare(byId.get(y[0]).label))
        .map(([id, count]) => ({ node: byId.get(id), count }));
      const ys = shared.map((p) => p.year);
      const minY = ys.length ? Math.min(...ys) : null, maxY = ys.length ? Math.max(...ys) : null;
      let trend = "";
      if (n === 0) trend = "No shared papers in this year range.";
      else if (minY === maxY) trend = `All ${plural(n, "paper")} were published in ${minY}.`;
      else {
        const mid = Math.floor((minY + maxY) / 2);
        const early = ys.filter((y) => y <= mid).length, late = n - early;
        const shape = late >= early * 1.5 ? "Growing over time" : early >= late * 1.5 ? "Mostly older work" : "Spread fairly evenly over time";
        trend = `${shape}: ${early} from ${minY}–${mid}, ${late} from ${mid + 1}–${maxY}.`;
      }
      // How surprising the pairing is: shared papers against what independence would predict.
      const expected = (countOf(a, f) * countOf(b, f)) / Math.max(1, papersIn(papers, f).length);
      const lift = expected ? n / expected : 0;
      return {
        a, b, link, papers: shared, n,
        sentence: connectionSentence(a, b, n),
        // Share of each concept's papers that also cover the other.
        shareOfA: countOf(a, f) ? n / countOf(a, f) : 0,
        shareOfB: countOf(b, f) ? n / countOf(b, f) : 0,
        lift,
        alongside,
        trend,
        earliest: n ? shared[shared.length - 1] : null,
        latest: n ? shared[0] : null
      };
    }

    // Papers that cover every concept in `ids` (an empty list means every paper).
    function papersWithAll(ids, f = null) {
      if (!ids.length) return papersIn(papers, f);
      const sets = ids.map((id) => new Set(byId.get(id).papers.map((p) => p.paper_id)));
      sets.sort((x, y) => x.size - y.size);
      return [...sets[0]].filter((pid) => sets.every((s) => s.has(pid))).map((pid) => paperById.get(pid)).filter((p) => inRange(p, f));
    }

    // Papers most like this one: the most concepts in common.
    function relatedPapers(paperId, limit = 5) {
      const mine = conceptsByPaper.get(paperId) || [];
      const counts = new Map();
      mine.forEach((cid) => byId.get(cid).papers.forEach((p) => {
        if (p.paper_id !== paperId) counts.set(p.paper_id, (counts.get(p.paper_id) || 0) + 1);
      }));
      return [...counts.entries()]
        .sort((x, y) => y[1] - x[1] || paperById.get(y[0]).year - paperById.get(x[0]).year)
        .slice(0, limit)
        .map(([id]) => {
          const theirs = new Set(conceptsByPaper.get(id));
          return { paper: paperById.get(id), shared: mine.filter((cid) => theirs.has(cid)).map((cid) => byId.get(cid)) };
        });
    }

    const conceptsOfPaper = (paperId) => (conceptsByPaper.get(paperId) || []).map((id) => byId.get(id));
    // Google Scholar search link; the data has no DOIs.
    const paperLink = (p) => `https://scholar.google.com/scholar?q=${encodeURIComponent(paperTitle(p))}`;

    return {
      meta: raw.meta || {},
      Y0, Y1,
      nodes, byId, links, linkBetween, other, adjacency, neighbors,
      types: nodeTypes, allTypes: types, typeOf, colorOf, typeRank,
      papers, paperById, conceptsOfPaper, papersWithAll, relatedPapers, paperLink,
      clusters, clusterById, corpusRecentShare,
      defaultFilter, rangeActive, inRange, papersIn, countOf, nodeVisible, linkVisible,
      search, connectionSentence, explainConnection,
      text: { esc, cap, plural, withArticle, listJoin, titleCase, paperTitle }
    };
  }

  // Fetches graph_data.json and atlas_schema.json from the project root (two levels up by default).
  async function load(base = "../../") {
    if (typeof location !== "undefined" && location.protocol === "file:") {
      throw new Error("This page has to be served over http. From the project folder run: python3 -m http.server 8000");
    }
    const [response, schemaResponse] = await Promise.all([
      fetch(`${base}graph_data.json`),
      fetch(`${base}atlas_schema.json`).catch(() => null)
    ]);
    if (!response.ok) throw new Error(`Could not load graph_data.json (HTTP ${response.status}).`);
    const raw = await response.json();
    const schemaFile = schemaResponse && schemaResponse.ok ? await schemaResponse.json() : null;
    return build(raw, schemaFile);
  }

  const api = { load, build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasCore = api;
})(typeof window !== "undefined" ? window : globalThis);
