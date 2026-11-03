// Atlas · Terrain. Ground position = what is studied together (seeded force layout over cosine
// co-occurrence), height = where papers concentrate (sum of Gaussians over visible concepts in the
// year range). Levels: landscape → region → concept → connection → paper, all hash-routed.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const atlas = await AtlasCore.load();
const { esc, plural, paperTitle, cap } = atlas.text;
const $ = (id) => document.getElementById(id);

// ---------- Constants ----------
const HALF = 120;                 // ground spans -HALF..HALF in x and z
const N = 160;                    // heightfield vertices per side
const STEP = (2 * HALF) / (N - 1);
const HMAX = 44;                  // tallest possible mountain (full year range)
const SIGMA = 6.4;
const STALK = 3.4;
const LOW_Z = 86;                 // lowlands strip starts here (south edge)
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------- State ----------
const state = {
  filter: atlas.defaultFilter(),
  route: {},
  mode: "3d",
  hover: null,           // {kind:'pin'|'arc'|'region', id, ...}
  showAllConn: false,
  playing: false
};

// ---------- Layout: deterministic 2D embedding ----------
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const regions = atlas.clusters.filter((c) => !c.unlinked);
const lowCluster = atlas.clusters.find((c) => c.unlinked);
const regionIndex = new Map(regions.map((c, i) => [c.id, i]));
const pos2 = new Map(); // id -> {x, z}
(function computeLayout() {
  const rnd = seeded(42);
  const linked = atlas.nodes.filter((n) => atlas.adjacency.get(n.id).length);
  const R = regions.length;
  const cosOf = (l) => l.shared / Math.sqrt(atlas.byId.get(l.a).paperCount * atlas.byId.get(l.b).paperCount);
  // Stage 1: place the regions themselves, pulled together by the co-occurrence between them.
  const between = new Map();
  atlas.links.forEach((l) => {
    const ca = atlas.byId.get(l.a).cluster, cb = atlas.byId.get(l.b).cluster;
    if (ca === cb || !regionIndex.has(ca) || !regionIndex.has(cb)) return;
    const k = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`;
    between.set(k, (between.get(k) || 0) + cosOf(l));
  });
  const maxB = Math.max(...between.values());
  const cnodes = regions.map((c, i) => { const r = 40 * Math.sqrt((i + 0.5) / R); const a = i * 2.39996; return { id: c.id, size: Math.sqrt(c.members.length), x: r * Math.cos(a), y: r * Math.sin(a) }; });
  const clinks = [...between].map(([k, w]) => { const [s, t] = k.split("|"); return { source: s, target: t, w: w / maxB }; });
  const cs = d3.forceSimulation(cnodes).randomSource(seeded(3))
    .force("link", d3.forceLink(clinks).id((d) => d.id).distance((l) => 34 + 30 * (1 - l.w)).strength((l) => 0.05 + 0.5 * l.w))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("collide", d3.forceCollide((d) => 8 + d.size * 5.2).strength(1))
    .force("center", d3.forceCenter(0, 0))
    .stop();
  for (let i = 0; i < 400; i++) cs.tick();
  const centers = cnodes.map((d) => [d.x, d.y]);
  // Stage 2: concepts around their region's center; links inside a region pull hard, links across pull lightly.
  const sim = linked.map((n) => { const ci = regionIndex.get(n.cluster); const c = centers[ci]; return { id: n.id, node: n, ci, x: c[0] + (rnd() - 0.5) * 10, y: c[1] + (rnd() - 0.5) * 10 }; });
  const simById = new Map(sim.map((d) => [d.id, d]));
  const links = atlas.links.filter((l) => simById.has(l.a) && simById.has(l.b)).map((l) => ({ source: l.a, target: l.b, w: cosOf(l), same: simById.get(l.a).ci === simById.get(l.b).ci }));
  function anchorForce(alpha) {
    sim.forEach((d) => { const c = centers[d.ci]; d.vx += (c[0] - d.x) * 0.22 * alpha; d.vy += (c[1] - d.y) * 0.22 * alpha; });
  }
  const s = d3.forceSimulation(sim).randomSource(seeded(7))
    .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => (l.same ? 6 : 30) + 16 * (1 - Math.min(1, l.w * 1.6))).strength((l) => Math.min(0.9, l.w * (l.same ? 1.3 : 0.12))))
    .force("charge", d3.forceManyBody().strength(-14).distanceMax(40))
    .force("collide", d3.forceCollide((d) => 2.4 + Math.sqrt(d.node.paperCount) * 0.22).strength(0.9))
    .force("anchor", anchorForce)
    .stop();
  for (let i = 0; i < 500; i++) s.tick();
  const xs = sim.map((d) => d.x), ys = sim.map((d) => d.y);
  const [x0, x1] = d3.extent(xs), [y0, y1] = d3.extent(ys);
  const W = 196, Hh = 172;
  const k = Math.min(W / (x1 - x0), Hh / (y1 - y0));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  sim.forEach((d) => pos2.set(d.id, { x: (d.x - mx) * k, z: (d.y - my) * k - 14 }));
  // Lowlands: unlinked concepts on two staggered rows along the south edge.
  const low = lowCluster ? lowCluster.members : [];
  // Slots ordered from the middle outwards, so the biggest unlinked concepts sit mid-strip.
  const slots = low.map((_, i) => { const cols = Math.ceil(low.length / 2); const col = Math.floor(i / 2), row = i % 2; return { x: -96 + (192 * (col + row * 0.5)) / Math.max(1, cols - 0.5), z: LOW_Z + 10 + row * 9 }; })
    .sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  low.forEach((n, i) => pos2.set(n.id, slots[i]));
})();

// Region geometry: anchor point (paper-weighted centroid) and extent.
const regionInfo = new Map();
[...regions, ...(lowCluster ? [lowCluster] : [])].forEach((c) => {
  let sx = 0, sz = 0, sw = 0;
  c.members.forEach((n) => { const p = pos2.get(n.id); const w = Math.sqrt(n.paperCount); sx += p.x * w; sz += p.z * w; sw += w; });
  const cx = sx / sw, cz = sz / sw;
  const r = Math.max(14, ...c.members.map((n) => { const p = pos2.get(n.id); return Math.hypot(p.x - cx, p.z - cz); }));
  regionInfo.set(c.id, { x: cx, z: cz, r });
});
if (lowCluster) regionInfo.set(lowCluster.id, { x: 0, z: LOW_Z + 14, r: 100 });

// ---------- Heightfield ----------
const heights = new Float32Array(N * N);
let fromH = new Float32Array(N * N), toH = new Float32Array(N * N);
let morph = null; // {t0, dur}
const refMaxCache = new Map();
function splat(filter) {
  const s = new Float32Array(N * N);
  const rCells = Math.ceil((3 * SIGMA) / STEP);
  const inv = 1 / (2 * SIGMA * SIGMA);
  atlas.nodes.forEach((n) => {
    if (filter.types && !filter.types.has(n.type)) return;
    const w = atlas.countOf(n, filter);
    if (!w) return;
    const p = pos2.get(n.id);
    const ci = Math.round((p.x + HALF) / STEP), cj = Math.round((p.z + HALF) / STEP);
    for (let j = Math.max(0, cj - rCells); j <= Math.min(N - 1, cj + rCells); j++) {
      const dz = -HALF + j * STEP - p.z;
      for (let i = Math.max(0, ci - rCells); i <= Math.min(N - 1, ci + rCells); i++) {
        const dx = -HALF + i * STEP - p.x;
        s[j * N + i] += w * Math.exp(-(dx * dx + dz * dz) * inv);
      }
    }
  });
  return s;
}
function refMax(filter) {
  const key = [...filter.types].sort().join(",");
  if (!refMaxCache.has(key)) {
    const s = splat({ ...filter, range: [atlas.Y0, atlas.Y1] });
    let m = 0; for (let i = 0; i < s.length; i++) m = Math.max(m, s[i]);
    refMaxCache.set(key, m || 1);
  }
  return refMaxCache.get(key);
}
function targetHeights(filter) {
  const s = splat(filter);
  const m = refMax(filter);
  const out = new Float32Array(N * N);
  for (let i = 0; i < s.length; i++) out[i] = HMAX * Math.sqrt(s[i] / m);
  return out;
}
function heightAt(x, z) {
  const fx = (x + HALF) / STEP, fz = (z + HALF) / STEP;
  if (fx < 0 || fz < 0 || fx > N - 1 || fz > N - 1) return 0;
  const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fz));
  const u = fx - i, v = fz - j;
  const a = heights[j * N + i], b = heights[j * N + i + 1], c = heights[(j + 1) * N + i], d = heights[(j + 1) * N + i + 1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// ---------- three.js scene ----------
const canvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const BG = new THREE.Color("#0b0d12");
renderer.setClearColor(BG, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 28;
controls.maxDistance = 360;
controls.minPolarAngle = 0.12;
controls.maxPolarAngle = 1.22;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1d26, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-60, 120, 40);
scene.add(sun);

// Ground texture: provinces (regions) and the lowlands strip, redrawn when the focus changes.
const TEX = 1024;
const texCanvas = document.createElement("canvas");
texCanvas.width = texCanvas.height = TEX;
const texCtx = texCanvas.getContext("2d");
const groundTex = new THREE.CanvasTexture(texCanvas);
groundTex.colorSpace = THREE.NoColorSpace;
groundTex.anisotropy = 4;

// Region masks: each ground cell belongs to the nearest concept within reach, and so to its region.
const MASK = 192;
const regionPaths = (function buildRegionShapes() {
  const owner = new Int16Array(MASK * MASK).fill(-1);
  const pts = regions.flatMap((c, ri) => c.members.map((n) => ({ ...pos2.get(n.id), ri })));
  const reach = 13;
  for (let j = 0; j < MASK; j++) {
    const z = -HALF + ((j + 0.5) / MASK) * 2 * HALF;
    for (let i = 0; i < MASK; i++) {
      const x = -HALF + ((i + 0.5) / MASK) * 2 * HALF;
      let best = reach * reach, bi = -1;
      for (const p of pts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; bi = p.ri; } }
      owner[j * MASK + i] = bi;
    }
  }
  const paths = regions.map((c, ri) => {
    const v = new Float64Array(MASK * MASK);
    for (let k = 0; k < v.length; k++) v[k] = owner[k] === ri ? 1 : 0;
    // light blur so outlines are smooth
    const b = new Float64Array(MASK * MASK);
    for (let j = 0; j < MASK; j++) for (let i = 0; i < MASK; i++) {
      let s = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const jj = j + dj, ii = i + di;
        if (jj >= 0 && jj < MASK && ii >= 0 && ii < MASK) { s += v[jj * MASK + ii]; n++; }
      }
      b[j * MASK + i] = s / n;
    }
    return d3.contours().size([MASK, MASK]).thresholds([0.5])(b)[0];
  });
  return { owner, paths };
})();
function regionAt(x, z) {
  if (z > LOW_Z && lowCluster) return lowCluster.id;
  const i = Math.floor(((x + HALF) / (2 * HALF)) * MASK), j = Math.floor(((z + HALF) / (2 * HALF)) * MASK);
  if (i < 0 || j < 0 || i >= MASK || j >= MASK) return null;
  const ri = regionPaths.owner[j * MASK + i];
  return ri >= 0 ? regions[ri].id : null;
}

function drawGround(focusRegion) {
  const ctx = texCtx;
  ctx.clearRect(0, 0, TEX, TEX);
  const path = d3.geoPath(d3.geoIdentity().scale(TEX / MASK), ctx);
  const toPx = (w) => ((w + HALF) / (2 * HALF)) * TEX;
  if (focusRegion) { ctx.fillStyle = "rgba(4,5,8,0.5)"; ctx.fillRect(0, 0, TEX, TEX); }
  regions.forEach((c, ri) => {
    const shape = regionPaths.paths[ri];
    if (!shape) return;
    const isF = focusRegion === c.id;
    ctx.beginPath(); path(shape);
    if (isF) {
      ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "#000"; ctx.fill(); ctx.restore();
      ctx.fillStyle = "rgba(139,197,255,0.13)"; ctx.fill();
    } else {
      ctx.fillStyle = ri % 2 ? "rgba(170,182,205,0.05)" : "rgba(170,182,205,0.085)"; ctx.fill();
    }
    ctx.setLineDash(isF ? [] : [6, 6]);
    ctx.lineWidth = isF ? 3 : 1.6;
    ctx.strokeStyle = isF ? "rgba(139,197,255,0.85)" : "rgba(220,228,240,0.30)";
    ctx.stroke();
  });
  // Lowlands strip
  const isLow = lowCluster && focusRegion === lowCluster.id;
  if (isLow) { ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillRect(toPx(-108), toPx(LOW_Z), toPx(108) - toPx(-108), toPx(HALF - 4) - toPx(LOW_Z)); ctx.restore(); }
  ctx.fillStyle = isLow ? "rgba(139,197,255,0.10)" : "rgba(120,130,150,0.07)";
  ctx.fillRect(toPx(-108), toPx(LOW_Z), toPx(108) - toPx(-108), toPx(HALF - 4) - toPx(LOW_Z));
  ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeStyle = isLow ? "rgba(139,197,255,0.8)" : "rgba(220,228,240,0.28)";
  ctx.strokeRect(toPx(-108), toPx(LOW_Z), toPx(108) - toPx(-108), toPx(HALF - 4) - toPx(LOW_Z));
  ctx.setLineDash([]);
  groundTex.needsUpdate = true;
  dirty = true;
}

// Terrain mesh with a custom shader: height tint, live contour lines, faint grid, distance fog.
const geo = new THREE.BufferGeometry();
const posArr = new Float32Array(N * N * 3), uvArr = new Float32Array(N * N * 2);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i;
  posArr[k * 3] = -HALF + i * STEP; posArr[k * 3 + 1] = 0; posArr[k * 3 + 2] = -HALF + j * STEP;
  uvArr[k * 2] = i / (N - 1); uvArr[k * 2 + 1] = 1 - j / (N - 1);
}
const idx = [];
for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
  const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
  idx.push(a, c, b, b, c, d);
}
geo.setIndex(idx);
geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
geo.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
geo.computeVertexNormals();
const terrainMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: groundTex },
    uMaxH: { value: HMAX },
    uInterval: { value: 2.0 },
    uLow: { value: new THREE.Color("#141824") },
    uHigh: { value: new THREE.Color("#56627a") },
    uLine: { value: new THREE.Color("#c9d6ee") },
    uBg: { value: BG.clone() },
    uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.35).normalize() },
    uFogNear: { value: 220 },
    uFogFar: { value: 520 },
    uContour: { value: 1.0 }
  },
  vertexShader: `
    varying vec3 vPos; varying vec3 vNormal; varying vec2 vUv; varying float vDist;
    void main() {
      vPos = position; vNormal = normal; vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform sampler2D uMap; uniform float uMaxH; uniform float uInterval; uniform vec3 uLow; uniform vec3 uHigh;
    uniform vec3 uLine; uniform vec3 uBg; uniform vec3 uLightDir; uniform float uFogNear; uniform float uFogFar; uniform float uContour;
    varying vec3 vPos; varying vec3 vNormal; varying vec2 vUv; varying float vDist;
    float lineOf(float v) { float w = fwidth(v) + 1e-5; float f = abs(fract(v - 0.5) - 0.5) / w; return 1.0 - min(f, 1.0); }
    void main() {
      float h = vPos.y;
      float t = clamp(h / uMaxH, 0.0, 1.0);
      vec3 base = mix(uLow, uHigh, pow(t, 0.75));
      vec4 tex = texture2D(uMap, vUv);
      base = mix(base, tex.rgb, tex.a);
      float diff = clamp(dot(normalize(vNormal), uLightDir), 0.0, 1.0);
      vec3 col = base * (0.55 + 0.7 * diff);
      float on = smoothstep(0.25, 0.7, h);
      float c1 = lineOf(h / uInterval);
      float c5 = lineOf(h / (uInterval * 5.0));
      col = mix(col, uLine, (c1 * 0.22 + c5 * 0.42) * on * uContour);
      vec2 g = vPos.xz / 10.0;
      float gl = max(lineOf(g.x), lineOf(g.y));
      col = mix(col, uLine, gl * 0.045);
      float fog = smoothstep(uFogNear, uFogFar, vDist);
      gl_FragColor = vec4(mix(col, uBg, fog), 1.0);
    }`
});
terrainMat.extensions = { derivatives: true };
const terrain = new THREE.Mesh(geo, terrainMat);
scene.add(terrain);

// A thin skirt plane far below so the map edge reads as an edge.
const edge = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + 0.5, 2 * HALF + 0.5), new THREE.MeshBasicMaterial({ color: 0x0e1118 }));
edge.rotation.x = -Math.PI / 2; edge.position.y = -0.05;
scene.add(edge);

// ---------- Pins ----------
const pinGeo = new THREE.SphereGeometry(1, 18, 12);
const pins = new Map(); // id -> {mesh, mat, node, r, alpha}
const pinGroup = new THREE.Group();
scene.add(pinGroup);
atlas.nodes.forEach((n) => {
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(atlas.colorOf(n.type)), emissive: new THREE.Color(atlas.colorOf(n.type)).multiplyScalar(0.35), transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(pinGeo, mat);
  mesh.userData.id = n.id;
  pinGroup.add(mesh);
  pins.set(n.id, { mesh, mat, node: n, r: 1, alpha: 1, alphaTo: 1, visible: true });
});
const stalkGeo = new THREE.BufferGeometry();
const stalkPos = new Float32Array(atlas.nodes.length * 6);
const stalkCol = new Float32Array(atlas.nodes.length * 6);
stalkGeo.setAttribute("position", new THREE.BufferAttribute(stalkPos, 3));
stalkGeo.setAttribute("color", new THREE.BufferAttribute(stalkCol, 3));
const stalks = new THREE.LineSegments(stalkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }));
scene.add(stalks);

function pinTop(id) { const p = pos2.get(id); const pin = pins.get(id); return new THREE.Vector3(p.x, heightAt(p.x, p.z) + STALK + pin.r, p.z); }
function updatePinPositions() {
  atlas.nodes.forEach((n, i) => {
    const p = pos2.get(n.id), pin = pins.get(n.id);
    const g = heightAt(p.x, p.z);
    pin.mesh.position.set(p.x, g + STALK + pin.r, p.z);
    stalkPos.set([p.x, g, p.z, p.x, g + STALK + pin.r * 0.3, p.z], i * 6);
  });
  stalkGeo.attributes.position.needsUpdate = true;
}
function updatePinColors() {
  atlas.nodes.forEach((n, i) => {
    const pin = pins.get(n.id);
    const c = new THREE.Color(atlas.colorOf(n.type));
    const a = pin.visible ? pin.alpha : 0;
    c.lerp(BG, 1 - a * 0.9);
    stalkCol.set([c.r * 0.5, c.g * 0.5, c.b * 0.5, c.r, c.g, c.b], i * 6);
    pin.mat.opacity = a;
    pin.mesh.visible = pin.visible && a > 0.02;
  });
  stalkGeo.attributes.color.needsUpdate = true;
}
function sizePins() {
  atlas.nodes.forEach((n) => {
    const pin = pins.get(n.id);
    const c = atlas.countOf(n, state.filter);
    pin.visible = atlas.nodeVisible(n, state.filter);
    pin.r = 0.55 + Math.sqrt(c) * 0.13;
    pin.mesh.scale.setScalar(pin.r);
  });
}

// ---------- Arcs (connections of the focused concept) ----------
const arcGroup = new THREE.Group();
scene.add(arcGroup);
let arcGrow = null;
function clearArcs() { arcGroup.children.slice().forEach((m) => { m.geometry.dispose(); m.material.dispose(); arcGroup.remove(m); }); }
function makeArc(aId, bId, shared, color, opts = {}) {
  const A = pinTop(aId), B = pinTop(bId);
  const d = Math.hypot(A.x - B.x, A.z - B.z);
  const mid = new THREE.Vector3((A.x + B.x) / 2, Math.max(A.y, B.y) + 3 + d * 0.2 + Math.sqrt(shared) * 0.7, (A.z + B.z) / 2);
  const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
  const radius = opts.radius ?? 0.1 + Math.sqrt(shared) * 0.085;
  const tube = new THREE.TubeGeometry(curve, 40, radius, 6, false);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: opts.opacity ?? 0.8, depthWrite: false });
  const mesh = new THREE.Mesh(tube, mat);
  mesh.userData = { a: aId, b: bId, shared, baseOpacity: opts.opacity ?? 0.8 };
  mesh.renderOrder = 2;
  arcGroup.add(mesh);
  return mesh;
}
function startArcGrow() {
  arcGroup.children.forEach((m) => m.geometry.setDrawRange(0, reduceMotion ? Infinity : 0));
  arcGrow = reduceMotion ? null : { t0: performance.now(), dur: 900 };
}
// Paper threads: a marker above the paper's concepts, with lines down to each.
let paperMarker = null;

// ---------- Camera ----------
let tween = null;
let viewShift = 0, viewShiftTo = 0;
function sph(target, dist, polar, az) {
  return new THREE.Vector3(target.x + dist * Math.sin(polar) * Math.sin(az), target.y + dist * Math.cos(polar), target.z + dist * Math.sin(polar) * Math.cos(az));
}
function currentAz() { const o = camera.position.clone().sub(controls.target); return Math.atan2(o.x, o.z); }
function flyTo(target, dist, opts = {}) {
  const polar = state.mode === "map" ? 0.0015 : (opts.polar ?? 0.92);
  const az = state.mode === "map" ? 0 : (opts.az ?? currentAz());
  const pos = sph(target, dist, polar, az);
  if (reduceMotion || opts.instant) { camera.position.copy(pos); controls.target.copy(target); controls.update(); dirty = true; return; }
  tween = { t0: performance.now(), dur: opts.dur ?? 1300, p0: camera.position.clone(), t0v: controls.target.clone(), p1: pos, t1v: target.clone() };
}
function frameIds(ids, opts = {}) {
  const pts = ids.map((id) => pos2.get(id)).filter(Boolean);
  if (!pts.length) return flyHome();
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const r = Math.max(opts.minR ?? 16, ...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
  const dist = Math.min(340, Math.max(opts.minDist ?? 60, r * (opts.k ?? 2.7) + 40));
  flyTo(new THREE.Vector3(cx, Math.min(16, heightAt(cx, cz) * 0.55), cz), dist, opts);
}
function flyHome(opts = {}) { if (state.mode === "map") flyTo(new THREE.Vector3(0, 0, 6), 430, opts); else flyTo(new THREE.Vector3(0, 2, 26), 315, { az: 0, polar: 0.82, ...opts }); }

// ---------- Labels overlay ----------
const labelLayer = $("labels");
const labelEls = new Map();
let labelItems = [];
function labelEl(key, html, cls) {
  let L = labelEls.get(key);
  if (!L) { const el = document.createElement("div"); labelLayer.appendChild(el); L = { el, html: null, cls: null, w: 0, h: 0, shown: false }; labelEls.set(key, L); }
  if (L.html !== html || L.cls !== cls) { L.el.innerHTML = html; L.el.className = `tl ${cls}${L.shown ? "" : " hide"}`; L.html = html; L.cls = cls; L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
  return L;
}
function occluded(p) {
  const c = camera.position;
  for (let s = 1; s < 28; s++) {
    const t = s / 28;
    const x = c.x + (p.x - c.x) * t, y = c.y + (p.y - c.y) * t, z = c.z + (p.z - c.z) * t;
    if (heightAt(x, z) > y + 0.4) return true;
  }
  return false;
}
function pinLabelHtml(n, extra = "") {
  return `<span class="dot" style="background:${atlas.colorOf(n.type)}"></span>${esc(n.label)}<span class="n">${extra || atlas.countOf(n, state.filter)}</span>`;
}
function regionLabelHtml(c) {
  const parts = c.name.split(" & ");
  return parts.length > 1 ? `${esc(parts[0])} <small>&amp; ${esc(parts.slice(1).join(" & "))}</small>` : esc(c.name);
}
function layoutLabels() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const placed = [];
  const seen = new Set();
  const items = labelItems.slice();
  if (state.hover && state.hover.kind === "pin" && !items.some((it) => it.key === `p${state.hover.id}`)) {
    const n = atlas.byId.get(state.hover.id);
    items.push({ key: `p${n.id}`, pos: () => pinTop(n.id), html: pinLabelHtml(n), cls: "lbl-pin hover", prio: 1000, always: true });
  }
  items.sort((a, b) => b.prio - a.prio);
  const v = new THREE.Vector3();
  for (const it of items) {
    const L = labelEl(it.key, it.html, it.cls);
    seen.add(it.key);
    const p = it.pos();
    v.copy(p).project(camera);
    let ok = v.z < 1 && v.z > -1;
    const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
    const ox = it.anchor === "center" ? L.w / 2 : L.w / 2;
    const oy = it.anchor === "center" ? L.h / 2 : L.h + 8;
    const box = [x - ox - 3, y - oy - 2, x - ox + L.w + 3, y - oy + L.h + 2];
    if (ok && (box[2] < 0 || box[0] > W || box[1] < 58 || box[3] > H - 4)) ok = false;
    let occ = false;
    if (ok && !it.always && occluded(p)) { if (it.keep) occ = true; else ok = false; }
    L.el.classList.toggle("occ", occ);
    if (ok && placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) ok = false;
    if (ok) { placed.push(box); L.el.style.transform = `translate(${(x - ox).toFixed(1)}px, ${(y - oy).toFixed(1)}px)`; L.el.classList.remove("hide"); L.shown = true; }
    else { L.el.classList.add("hide"); L.shown = false; }
  }
  labelEls.forEach((L, key) => { if (!seen.has(key)) { L.el.remove(); labelEls.delete(key); } });
}

// ---------- Rendering loop ----------
let dirty = true;
let W0 = 0, H0 = 0;
function resize() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (W === W0 && H === H0) return;
  W0 = W; H0 = H;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  applyViewShift();
  dirty = true;
}
function applyViewShift() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (Math.abs(viewShift) > 0.5) camera.setViewOffset(W, H, viewShift, 0, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function clampTarget() {
  const t = controls.target;
  const lim = HALF - 10;
  const cx = Math.max(-lim, Math.min(lim, t.x)), cz = Math.max(-lim, Math.min(lim, t.z)), cy = Math.max(0, Math.min(30, t.y));
  if (cx !== t.x || cz !== t.z || cy !== t.y) { const d = new THREE.Vector3(cx - t.x, cy - t.y, cz - t.z); t.add(d); camera.position.add(d); }
}
controls.addEventListener("change", () => { clampTarget(); dirty = true; });

function frame(now) {
  requestAnimationFrame(frame);
  resize();
  let active = false;
  if (tween) {
    const t = Math.min(1, (now - tween.t0) / tween.dur), e = ease(t);
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    // lift the path a little so long flights arc over the land
    camera.position.y += Math.sin(Math.PI * e) * Math.min(60, tween.p0.distanceTo(tween.p1) * 0.12);
    controls.target.lerpVectors(tween.t0v, tween.t1v, e);
    camera.lookAt(controls.target);
    if (t >= 1) tween = null;
    active = true;
  }
  if (morph) {
    const t = Math.min(1, (now - morph.t0) / morph.dur), e = ease(t);
    for (let i = 0; i < heights.length; i++) heights[i] = fromH[i] + (toH[i] - fromH[i]) * e;
    syncTerrain();
    if (t >= 1) { morph = null; if (arcGroup.children.length) rebuildArcsAfterMorph(); }
    active = true;
  }
  if (Math.abs(viewShift - viewShiftTo) > 0.5) { viewShift += (viewShiftTo - viewShift) * (reduceMotion ? 1 : 0.12); applyViewShift(); active = true; }
  else if (viewShift !== viewShiftTo) { viewShift = viewShiftTo; applyViewShift(); active = true; }
  let alphaMoving = false;
  pins.forEach((pin) => { if (Math.abs(pin.alpha - pin.alphaTo) > 0.01) { pin.alpha += (pin.alphaTo - pin.alpha) * (reduceMotion ? 1 : 0.15); alphaMoving = true; } else pin.alpha = pin.alphaTo; });
  if (alphaMoving) { updatePinColors(); active = true; }
  if (arcGrow) {
    const t = Math.min(1, (now - arcGrow.t0) / arcGrow.dur), e = ease(t);
    arcGroup.children.forEach((m) => m.geometry.setDrawRange(0, Math.ceil(m.geometry.index.count * e / 3) * 3));
    if (t >= 1) arcGrow = null;
    active = true;
  }
  if (!tween && controls.update()) active = true;
  if (active || dirty) {
    renderer.render(scene, camera);
    layoutLabels();
    updateCompass();
    dirty = false;
  }
}
function syncTerrain() {
  for (let k = 0; k < N * N; k++) posArr[k * 3 + 1] = heights[k];
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  updatePinPositions();
  if (paperMarker) positionPaperMarker();
}
function setTerrain(dur = 750) {
  toH = targetHeights(state.filter);
  if (reduceMotion || dur === 0) { heights.set(toH); syncTerrain(); morph = null; dirty = true; return; }
  fromH = heights.slice();
  morph = { t0: performance.now(), dur };
}
function rebuildArcsAfterMorph() { buildFocusGraphics(false); }

// ---------- Compass ----------
const needle = $("compass-needle");
function updateCompass() {
  const az = currentAz();
  needle.setAttribute("transform", `rotate(${(az * 180) / Math.PI})`);
}

// ---------- Routing ----------
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const r = {};
  for (let i = 0; i + 1 < parts.length; i += 2) r[parts[i]] = parts[i + 1];
  if (r.concept && !atlas.byId.has(r.concept)) delete r.concept;
  if (r.with && (!r.concept || !atlas.byId.has(r.with) || !atlas.linkBetween(r.concept, r.with))) delete r.with;
  if (r.region && !atlas.clusterById.has(r.region)) delete r.region;
  if (r.paper && !atlas.paperById.has(Number(r.paper))) delete r.paper;
  return r;
}
function hashOf(r) {
  const order = ["region", "concept", "with", "paper"];
  const s = order.filter((k) => r[k] != null).map((k) => `${k}/${encodeURIComponent(r[k])}`).join("/");
  return `#/${s}`;
}
function go(r) {
  const h = hashOf(r);
  if (location.hash === h) applyRoute(); else location.hash = h;
}
function levelOf(r) { return r.paper ? "paper" : r.with ? "link" : r.concept ? "concept" : r.region ? "region" : "home"; }
function parentOf(r) {
  if (r.paper) { const { paper, ...rest } = r; return rest; }
  if (r.with) return { concept: r.concept };
  if (r.concept) return { region: atlas.byId.get(r.concept).cluster };
  return {};
}
window.addEventListener("hashchange", () => applyRoute());

function applyRoute(opts = {}) {
  const r = parseHash();
  const prev = state.route;
  state.route = r;
  state.showAllConn = prev.concept === r.concept ? state.showAllConn : false;
  const lvl = levelOf(r);
  document.body.dataset.level = lvl;
  renderCrumbs();
  buildFocusGraphics(true);
  renderPanel();
  $("intro").hidden = lvl !== "home";
  $("legend-arc").hidden = !(lvl === "concept" || lvl === "link");
  const panelOpen = lvl !== "home";
  document.body.classList.toggle("panel-open", panelOpen);
  viewShiftTo = panelOpen ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-w")) + 16) / 2 : -($("intro").offsetWidth + 16) / 2;
  tooltip.hidden = true;
  if (opts.noFly) return;
  frameRoute();
}
function frameRoute(extra = {}) {
  const r = state.route, lvl = levelOf(r);
  const map = state.mode === "map";
  if (lvl === "home") flyHome(extra);
  else if (lvl === "region") {
    const c = atlas.clusterById.get(r.region);
    if (c.unlinked) frameIds(c.members.map((n) => n.id), { polar: 0.8, k: 1.6, ...extra });
    else frameIds(c.members.map((n) => n.id), { polar: 0.72, k: 3, minDist: map ? 160 : 135, ...extra });
  } else if (lvl === "concept") {
    const nb = atlas.neighbors(r.concept, state.filter).slice(0, 10).map((x) => x.node.id);
    frameIds([r.concept, ...nb], { polar: 0.9, minDist: map ? 150 : 60, ...extra });
  } else if (lvl === "link") frameIds([r.concept, r.with], { minR: 22, polar: 0.62, minDist: map ? 160 : 120, ...extra });
  else if (lvl === "paper") frameIds(atlas.conceptsOfPaper(Number(r.paper)).map((n) => n.id), { minR: 20, polar: 0.82, minDist: map ? 160 : 60, ...extra });
}

// Which pins are lit, which arcs exist, which labels show, and the ground focus.
function buildFocusGraphics(fresh) {
  const r = state.route, f = state.filter, lvl = levelOf(r);
  clearArcs();
  if (paperMarker) { scene.remove(paperMarker.group); paperMarker.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); paperMarker = null; }
  let lit = null; // Set of ids at full strength; null = all
  const items = [];
  const visibleNodes = atlas.nodes.filter((n) => atlas.nodeVisible(n, f));
  const regionLabels = (dimAll, focusId) => regions.concat(lowCluster ? [] : []).forEach((c) => {
    const info = regionInfo.get(c.id);
    if (!c.members.some((n) => atlas.nodeVisible(n, f))) return;
    const isF = c.id === focusId;
    items.push({ key: `r${c.id}`, pos: () => new THREE.Vector3(info.x, heightAt(info.x, info.z) + 7, info.z), html: regionLabelHtml(c), cls: `lbl-region${isF ? " focus" : dimAll ? " dim" : ""}`, prio: isF ? 450 : dimAll ? 100 + c.paperCount / 100 : 500 + c.paperCount / 100, anchor: "center" });
  });
  const lowLabel = (focus) => lowCluster && items.push({ key: "low", pos: () => new THREE.Vector3(30, 1, LOW_Z + 3), html: `Outskirts · ${lowCluster.members.length} concepts with no links in the data`, cls: `lbl-low${focus ? "" : ""}`, prio: focus ? 880 : 400, anchor: "center" });
  const pinItem = (n, cls, prio, extra) => items.push({ key: `p${n.id}`, pos: () => pinTop(n.id), html: pinLabelHtml(n, extra), cls: `lbl-pin ${cls}`, prio, keep: cls === "focus" });

  if (lvl === "home") {
    regionLabels(false, null);
    lowLabel(false);
    visibleNodes.slice().sort((a, b) => atlas.countOf(b, f) - atlas.countOf(a, f)).slice(0, 8).forEach((n, i) => pinItem(n, "peak", i < 3 ? 700 - i : 300 - i));
    drawGround(null);
  } else if (lvl === "region") {
    const c = atlas.clusterById.get(r.region);
    lit = new Set(c.members.map((n) => n.id));
    if (c.unlinked) lowLabel(true); else { regionLabels(true, c.id); lowLabel(false); }
    c.members.filter((n) => atlas.nodeVisible(n, f)).sort((a, b) => atlas.countOf(b, f) - atlas.countOf(a, f)).forEach((n, i) => pinItem(n, i < 3 ? "peak" : "", 800 - i));
    drawGround(c.id);
  } else if (lvl === "concept" || lvl === "link") {
    const focus = atlas.byId.get(r.concept);
    const nbs = atlas.neighbors(focus.id, f);
    lit = new Set([focus.id, ...nbs.map((x) => x.node.id)]);
    pinItem(focus, "focus", 990, `${atlas.countOf(focus, f)} papers`);
    if (lvl === "concept") {
      nbs.forEach((x, i) => makeArc(focus.id, x.node.id, x.shared, atlas.colorOf(x.node.type), i < 24 ? {} : { opacity: 0.22, radius: 0.08 }));
      nbs.slice(0, 14).forEach((x, i) => pinItem(x.node, "", 700 - i, `${x.shared} shared`));
    } else {
      const other = atlas.byId.get(r.with);
      lit = new Set([focus.id, other.id]);
      const shared = atlas.countOf(atlas.linkBetween(focus.id, other.id), f);
      nbs.forEach((x) => { if (x.node.id !== other.id) makeArc(focus.id, x.node.id, x.shared, "#5b6375", { opacity: 0.12 }); });
      makeArc(focus.id, other.id, Math.max(1, shared), "#ffffff", { opacity: 0.95, radius: 0.25 + Math.sqrt(Math.max(1, shared)) * 0.12 });
      pinItem(other, "focus", 980, `${shared} shared`);
    }
    drawGround(focus.cluster || null);
    if (fresh) startArcGrow();
  } else if (lvl === "paper") {
    const pid = Number(r.paper);
    const cs = atlas.conceptsOfPaper(pid);
    lit = new Set(cs.map((n) => n.id));
    cs.forEach((n, i) => pinItem(n, "focus", 900 - i, atlas.typeOf(n.type).label.toLowerCase()));
    buildPaperMarker(pid, cs);
    items.push({ key: "paper", pos: () => paperMarker.top.clone(), html: `${atlas.paperById.get(pid).year} · paper`, cls: "lbl-paper", prio: 1001, always: true });
    drawGround(null);
  }
  pins.forEach((pin, id) => { pin.alphaTo = !lit || lit.has(id) ? 1 : 0.13; });
  labelItems = items;
  updatePinColors();
  dirty = true;
}

function buildPaperMarker(pid, cs) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cs.length * 6), 3));
  const lines = new THREE.LineSegments(lineGeo, mat);
  const head = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 }));
  group.add(lines, head);
  scene.add(group);
  paperMarker = { group, lines, head, ids: cs.map((n) => n.id), top: new THREE.Vector3() };
  positionPaperMarker();
}
function positionPaperMarker() {
  const pts = paperMarker.ids.map((id) => pinTop(id));
  if (!pts.length) return;
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const spread = Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
  c.y = Math.max(...pts.map((p) => p.y)) + 6 + spread * 0.12;
  paperMarker.top.copy(c);
  paperMarker.head.position.copy(c);
  const arr = paperMarker.lines.geometry.attributes.position.array;
  pts.forEach((p, i) => arr.set([c.x, c.y, c.z, p.x, p.y, p.z], i * 6));
  paperMarker.lines.geometry.attributes.position.needsUpdate = true;
}

// ---------- Breadcrumbs ----------
function renderCrumbs() {
  const r = state.route;
  const crumbs = [{ label: "Landscape", route: {} }];
  const regionId = r.region || (r.concept && atlas.byId.get(r.concept).cluster) || null;
  if (regionId != null && regionId !== "" || (regionId === "" && false)) {}
  if (regionId != null && atlas.clusterById.has(regionId) && (r.region || r.concept)) {
    const c = atlas.clusterById.get(regionId);
    crumbs.push({ label: c.unlinked ? "Outskirts" : c.anchor.label + " region", route: { region: regionId } });
  }
  if (r.concept) crumbs.push({ label: atlas.byId.get(r.concept).label, route: { concept: r.concept } });
  if (r.with) crumbs.push({ label: `↔ ${atlas.byId.get(r.with).label}`, route: { concept: r.concept, with: r.with } });
  if (r.paper) crumbs.push({ label: `paper · ${atlas.paperById.get(Number(r.paper)).year}`, route: r });
  $("crumbs").innerHTML = crumbs.map((c, i) => `${i ? '<span class="sep">›</span>' : ""}<button data-i="${i}" class="${i === crumbs.length - 1 ? "cur" : ""}" title="${esc(c.label)}">${esc(c.label)}</button>`).join("");
  $("crumbs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const c = crumbs[+b.dataset.i]; if (+b.dataset.i < crumbs.length - 1) go(c.route); }));
}

// ---------- Panel ----------
const panelBody = $("panel-body");
function yearSpark(counts, h = 46, color = "#8bc5ff") {
  const f = state.filter, n = counts.length, max = Math.max(1, ...counts);
  const w = 360, bw = w / n;
  const bars = counts.map((c, i) => {
    const y = atlas.Y0 + i, inR = y >= f.range[0] && y <= f.range[1];
    const bh = c ? Math.max(2, (c / max) * (h - 4)) : 0;
    return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="${color}" opacity="${inR ? 0.9 : 0.22}"><title>${y}: ${c}</title></rect>`;
  }).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}<line x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}" stroke="rgba(255,255,255,0.12)"/></svg><div class="spark-axis"><span>${atlas.Y0}</span><span>${atlas.Y1}</span></div>`;
}
function countsByYear(papers) { const c = new Array(atlas.Y1 - atlas.Y0 + 1).fill(0); papers.forEach((p) => { if (p.year >= atlas.Y0 && p.year <= atlas.Y1) c[p.year - atlas.Y0]++; }); return c; }
function rangeText() { const [a, b] = state.filter.range; return a === b ? `${a}` : `${a}–${b}`; }
function conceptChip(n, extra = "") { return `<button class="chip" data-concept="${esc(n.id)}"><span class="dot" style="background:${atlas.colorOf(n.type)}"></span><span class="t">${esc(n.label)}</span>${extra ? `<span class="n">${extra}</span>` : ""}</button>`; }
function paperRows(papers, routeBase, limit = 12) {
  if (!papers.length) return `<div class="empty-note">No papers in ${rangeText()} match these filters.</div>`;
  return `<ul class="papers">${papers.slice(0, limit).map((p) => `<li><button data-paper="${p.paper_id}"><span class="pt">${esc(paperTitle(p))}</span><span class="pm">${p.year} · ${esc(p.authors || "authors unknown")}</span></button></li>`).join("")}</ul>${papers.length > limit ? `<div class="faint small mono" style="padding:4px 8px">+ ${papers.length - limit} more</div>` : ""}`;
}

function renderPanel() {
  const r = state.route, f = state.filter, lvl = levelOf(r);
  $("panel").hidden = lvl === "home";
  if (lvl === "home") return;
  let html = "";
  if (lvl === "region") {
    const c = atlas.clusterById.get(r.region);
    const members = c.members.filter((n) => atlas.nodeVisible(n, f)).sort((a, b) => atlas.countOf(b, f) - atlas.countOf(a, f));
    const pIds = new Set(c.members.flatMap((n) => atlas.papersIn(n.papers, f).map((p) => p.paper_id)));
    const byType = atlas.types.map((t) => ({ t, n: c.members.filter((m) => m.type === t.id).length })).filter((x) => x.n);
    const max = Math.max(1, ...members.map((n) => atlas.countOf(n, f)));
    html = `<div class="kicker">${c.unlinked ? "Outskirts" : "Region · concepts studied together"}</div>
      <h2>${esc(c.unlinked ? "Not linked to other concepts" : c.name)}</h2>
      <p class="desc">${c.unlinked ? "These concepts have no shared-paper links in the data: mostly one-paper concepts, plus two catch-alls (no design object, multi-phase design process) whose links the export leaves out. With no links there is nothing to place them by, so they sit apart on the south edge; their height still shows their papers." : `A neighborhood of concepts that tend to appear in the same papers. Its tallest peaks are the concepts most studied here.`}</p>
      <div class="stats two"><div class="stat"><b>${members.length}</b><span>concepts shown</span></div><div class="stat"><b>${pIds.size}</b><span>papers ${rangeText()}</span></div></div>
      <div class="typebar">${byType.map((x) => `<i style="flex:${x.n};background:${x.t.color}"></i>`).join("")}</div>
      <div class="typelegend">${byType.map((x) => `<span><span class="dot" style="background:${x.t.color}"></span> ${x.n} ${esc(x.n === 1 ? x.t.label.toLowerCase() : x.t.plural.toLowerCase())}</span>`).join("")}</div>
      <h3>Peaks in this region <span class="faint">papers</span></h3>
      ${members.length ? `<ul class="rows">${members.map((n) => `<li><button data-concept="${esc(n.id)}" data-hl="${esc(n.id)}"><span class="dot" style="background:${atlas.colorOf(n.type)}"></span><span class="lbl">${esc(n.label)}</span><span class="bar"><i style="width:${(100 * atlas.countOf(n, f)) / max}%;background:${atlas.colorOf(n.type)}"></i></span><span class="n">${atlas.countOf(n, f)}</span></button></li>`).join("")}</ul>` : `<div class="empty-note">No concepts here match these filters.</div>`}`;
  } else if (lvl === "concept") {
    const n = atlas.byId.get(r.concept), t = atlas.typeOf(n.type), c = atlas.clusterById.get(n.cluster);
    const nbs = atlas.neighbors(n.id, f);
    const max = Math.max(1, ...nbs.map((x) => x.shared));
    const shown = state.showAllConn ? nbs : nbs.slice(0, 25);
    const papers = atlas.papersIn(n.papers, f).slice().sort((a, b) => b.year - a.year);
    html = `<div class="kicker"><span class="dot" style="background:${t.color}"></span>${esc(t.label)} · <button class="linkish" data-region="${esc(c.id)}">${esc(c.unlinked ? "Outskirts" : c.anchor.label + " region")}</button></div>
      <h2>${esc(n.label)}</h2>
      ${n.description ? `<p class="desc">${esc(n.description)}</p>` : ""}
      ${atlas.nodeVisible(n, f) ? "" : `<div class="note-hidden">Hidden on the map by the current filters.</div>`}
      <div class="stats"><div class="stat"><b>${atlas.countOf(n, f)}</b><span>papers ${rangeText()}</span></div><div class="stat"><b>${nbs.length}</b><span>connections</span></div><div class="stat"><b>${n.firstYear || "—"}</b><span>first studied</span></div></div>
      <h3>Papers per year</h3>${yearSpark(n.yearCounts, 46, t.color)}
      <h3>Connections <span class="faint">ranked by shared papers</span></h3>
      ${nbs.length ? `<ul class="rows">${shown.map((x) => `<li><button data-with="${esc(x.node.id)}" data-hl="${esc(x.node.id)}"><span class="dot" style="background:${atlas.colorOf(x.node.type)}"></span><span class="lbl">${esc(x.node.label)}</span><span class="bar"><i style="width:${(100 * x.shared) / max}%;background:${atlas.colorOf(x.node.type)}"></i></span><span class="n">${x.shared}</span></button></li>`).join("")}</ul>
        ${nbs.length > 25 ? `<button class="ghost-btn more-btn" id="more-conn">${state.showAllConn ? "Show top 25" : `Show all ${nbs.length}`}</button>` : ""}` : `<div class="empty-note">${n.degree ? `No connections in ${rangeText()} match these filters.` : "This concept has no connections in the data (one-paper concepts, and two catch-alls whose links the export leaves out)."}</div>`}
      <h3>Papers <span class="faint">newest first</span></h3>${paperRows(papers)}`;
  } else if (lvl === "link") {
    const ex = atlas.explainConnection(r.concept, r.with, f);
    const { a, b } = ex;
    const expected = ex.lift ? ex.n / ex.lift : 0;
    const liftTxt = ex.n === 0 ? "No shared papers in this range." : ex.lift >= 1.15 ? `<b>${ex.lift.toFixed(1)}×</b> more often than chance` : ex.lift <= 0.87 ? `<b>Less often</b> than chance (${ex.lift.toFixed(1)}×)` : `<b>About as often</b> as chance`;
    html = `<div class="kicker">Connection</div>
      <div class="pair">${conceptChip(a)}<span class="x">↔</span>${conceptChip(b)}</div>
      <p class="sentence">${esc(cap(ex.sentence))}.</p>
      <div class="stats"><div class="stat"><b>${ex.n}</b><span>shared papers</span></div><div class="stat"><b>${Math.round(ex.shareOfA * 100)}%</b><span>of ${esc(a.label.length > 16 ? a.label.slice(0, 15) + "…" : a.label)}</span></div><div class="stat"><b>${Math.round(ex.shareOfB * 100)}%</b><span>of ${esc(b.label.length > 16 ? b.label.slice(0, 15) + "…" : b.label)}</span></div></div>
      <div class="callout">Studied together ${liftTxt}. ${ex.n ? `If the two were unrelated, about ${expected < 1 ? expected.toFixed(1) : Math.round(expected)} shared ${expected >= 0.95 && expected < 1.5 ? "paper" : "papers"} would be expected.` : ""}</div>
      <h3>Over time</h3>
      <p class="desc">${esc(ex.trend)}</p>${yearSpark(countsByYear(ex.papers), 40, "#eceff4")}
      <h3>What else these papers study <span class="faint">papers</span></h3>
      ${ex.alongside.length ? `<div class="chips">${ex.alongside.slice(0, 10).map((x) => conceptChip(x.node, x.count)).join("")}</div>` : `<div class="empty-note">Nothing else: these papers study only these two.</div>`}
      <h3>The shared papers <span class="faint">newest first</span></h3>${paperRows(ex.papers, null, 20)}`;
  } else if (lvl === "paper") {
    const p = atlas.paperById.get(Number(r.paper));
    const cs = atlas.conceptsOfPaper(p.paper_id);
    const rel = atlas.relatedPapers(p.paper_id, 6);
    html = `<div class="kicker">Paper · ${p.year}</div>
      <h2 class="paper-title">${esc(paperTitle(p))}</h2>
      <p class="desc">${esc(p.authors || "Authors unknown")} · ${p.year}</p>
      <h3>Concepts this paper covers <span class="faint">lit on the map</span></h3>
      <div class="chips">${cs.map((n) => conceptChip(n, atlas.typeOf(n.type).label.toLowerCase())).join("")}</div>
      <h3>Related papers <span class="faint">most concepts in common</span></h3>
      ${rel.length ? `<ul class="papers">${rel.map((x) => `<li><button data-paper="${x.paper.paper_id}"><span class="pt">${esc(paperTitle(x.paper))}</span><span class="pm">${x.paper.year} · shares ${esc(x.shared.slice(0, 3).map((n) => n.label).join(", "))}${x.shared.length > 3 ? ` +${x.shared.length - 3}` : ""}</span></button></li>`).join("")}</ul>` : `<div class="empty-note">No related papers.</div>`}
      <a class="ghost-btn scholar" href="${atlas.paperLink(p)}" target="_blank" rel="noopener">Find on Google Scholar ↗</a>
      <p class="faint small" style="margin-top:8px">The data has no DOIs or abstracts, so this searches by title.</p>`;
  }
  panelBody.innerHTML = html;
  panelBody.scrollTop = 0;
}
panelBody.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const r = state.route;
  if (b.id === "more-conn") { state.showAllConn = !state.showAllConn; const st = panelBody.scrollTop; renderPanel(); panelBody.scrollTop = st; return; }
  if (b.dataset.with) return go({ concept: r.concept, with: b.dataset.with });
  if (b.dataset.concept) return go({ concept: b.dataset.concept });
  if (b.dataset.region != null && b.dataset.region !== undefined && b.hasAttribute("data-region")) return go({ region: b.dataset.region });
  if (b.dataset.paper) {
    const base = r.with ? { concept: r.concept, with: r.with } : r.concept ? { concept: r.concept } : {};
    return go({ ...base, paper: b.dataset.paper });
  }
});
// Hovering a list row highlights that pin / arc on the map.
panelBody.addEventListener("mouseover", (e) => {
  const b = e.target.closest("[data-hl]");
  setHover(b ? { kind: "pin", id: b.dataset.hl } : null, true);
});
panelBody.addEventListener("mouseleave", () => setHover(null, true));

$("back-btn").addEventListener("click", () => go(parentOf(state.route)));
$("close-btn").addEventListener("click", () => go({}));
$("reset").addEventListener("click", () => { go({}); flyHome(); });
$("compass").addEventListener("click", () => {
  const t = controls.target.clone();
  flyTo(t, camera.position.distanceTo(t), { az: 0, polar: state.mode === "map" ? 0.0015 : 0.9, dur: 700 });
});

// ---------- Hover & picking ----------
const tooltip = $("tooltip");
const raycaster = new THREE.Raycaster();
function ndc(e) { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, px: e.clientX - r.left, py: e.clientY - r.top }; }
function pickPin(m) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  let best = null, bd = Infinity;
  const v = new THREE.Vector3();
  pins.forEach((pin, id) => {
    if (!pin.mesh.visible || pin.alpha < 0.5) return;
    v.copy(pin.mesh.position).project(camera);
    if (v.z > 1) return;
    const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
    const d = Math.hypot(x - m.px, y - m.py);
    if (d < 11 && d < bd && !occluded(pin.mesh.position)) { bd = d; best = id; }
  });
  return best;
}
function pickArc(m) {
  if (!arcGroup.children.length) return null;
  raycaster.setFromCamera(new THREE.Vector2(m.x, m.y), camera);
  const hit = raycaster.intersectObjects(arcGroup.children.filter((a) => a.material.opacity > 0.3), false)[0];
  return hit ? hit.object.userData : null;
}
function pickGround(m) {
  raycaster.setFromCamera(new THREE.Vector2(m.x, m.y), camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  for (let t = 0; t < 900; t += 1.2) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.abs(x) > HALF + 40 || Math.abs(z) > HALF + 40) { if (y < -5) return null; continue; }
    if (y <= heightAt(x, z)) return Math.abs(x) <= HALF && Math.abs(z) <= HALF ? { x, z } : null;
  }
  return null;
}
function setHover(h, fromPanel = false) {
  const same = JSON.stringify(h) === JSON.stringify(state.hover);
  if (same) return;
  state.hover = h;
  const key = h && (h.kind === "arc" ? `${h.a}|${h.b}` : h.kind === "pin" ? h.id : null);
  const anyMatch = key && arcGroup.children.some((x) => `${x.userData.a}|${x.userData.b}` === key || x.userData.b === key);
  arcGroup.children.forEach((a) => {
    const on = anyMatch && (`${a.userData.a}|${a.userData.b}` === key || a.userData.b === key);
    a.material.opacity = on ? 1 : a.userData.baseOpacity * (anyMatch ? 0.35 : 1);
  });
  canvas.classList.toggle("pointer", !!h);
  if (!fromPanel) panelBody.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl"));
  if (h && h.kind === "pin" && !fromPanel) panelBody.querySelectorAll(`[data-hl="${CSS.escape(h.id)}"]`).forEach((x) => x.classList.add("hl"));
  dirty = true;
}
let hoverPending = null;
canvas.addEventListener("pointermove", (e) => {
  if (e.buttons) { tooltip.hidden = true; return; }
  hoverPending = e;
  requestAnimationFrame(() => {
    if (!hoverPending) return;
    const ev = hoverPending; hoverPending = null;
    const m = ndc(ev);
    const pin = pickPin(m);
    let h = null, tip = "";
    if (pin) {
      const n = atlas.byId.get(pin);
      h = { kind: "pin", id: pin };
      const r = state.route;
      const link = r.concept && r.concept !== pin ? atlas.linkBetween(r.concept, pin) : null;
      tip = `<div class="tt-k">${esc(atlas.typeOf(n.type).label)}</div>${esc(n.label)}<div class="faint mono small">${atlas.countOf(n, state.filter)} papers${link ? ` · ${atlas.countOf(link, state.filter)} shared` : ""} · click to open</div>`;
    } else {
      const arc = pickArc(m);
      if (arc) {
        h = { kind: "arc", a: arc.a, b: arc.b };
        tip = `<div class="tt-k">Connection</div>${esc(atlas.byId.get(arc.a).label)} ↔ ${esc(atlas.byId.get(arc.b).label)}<div class="faint mono small">${arc.shared} shared papers · click for why</div>`;
      } else if (levelOf(state.route) === "home" || levelOf(state.route) === "region") {
        const g = pickGround(m);
        const rid = g ? regionAt(g.x, g.z) : null;
        if (rid != null && rid !== state.route.region) {
          const c = atlas.clusterById.get(rid);
          h = { kind: "region", id: rid };
          tip = `<div class="tt-k">${c.unlinked ? "Outskirts" : "Region"}</div>${esc(c.unlinked ? "Not linked to other concepts" : c.name)}<div class="faint mono small">${c.members.length} concepts · click to fly in</div>`;
        }
      }
    }
    setHover(h);
    if (tip) { tooltip.innerHTML = tip; tooltip.hidden = false; const x = Math.min(m.px + 14, canvas.clientWidth - 290); tooltip.style.left = `${x}px`; tooltip.style.top = `${m.py + 16}px`; }
    else tooltip.hidden = true;
  });
});
canvas.addEventListener("pointerleave", () => { tooltip.hidden = true; setHover(null); });
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; stopTween(); });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  downAt = null;
  const m = ndc(e);
  const pin = pickPin(m);
  const r = state.route;
  if (pin) {
    if (r.concept && r.concept !== pin && atlas.linkBetween(r.concept, pin) && !r.with) return go({ concept: r.concept, with: pin });
    return go({ concept: pin });
  }
  const arc = pickArc(m);
  if (arc) return go({ concept: arc.a, with: arc.b });
  const lvlNow = levelOf(r);
  const g = lvlNow === "home" || lvlNow === "region" ? pickGround(m) : null;
  if (g) {
    const rid = regionAt(g.x, g.z);
    if (rid != null && rid !== r.region) return go({ region: rid });
  }
});
canvas.addEventListener("wheel", () => stopTween(), { passive: true });
function stopTween() { if (tween) { tween = null; camera.lookAt(controls.target); } }

// ---------- Filters ----------
function renderTypes() {
  $("types").innerHTML = atlas.types.map((t) => `<button class="type-btn ${state.filter.types.has(t.id) ? "" : "off"}" data-type="${t.id}" title="Show or hide ${esc(t.plural.toLowerCase())}; the land is rebuilt from the visible types"><span class="dot" style="background:${t.color};color:${t.color}"></span>${esc(t.plural)}<span class="n">${t.count}</span></button>`).join("");
}
$("types").addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]");
  if (!b) return;
  const id = b.dataset.type, s = state.filter.types;
  if (s.has(id) && s.size === 1) { atlas.types.forEach((t) => s.add(t.id)); }
  else if (e.altKey || e.metaKey) { s.clear(); s.add(id); }
  else if (s.has(id)) s.delete(id); else s.add(id);
  renderTypes();
  onFilterChange();
});
const y0 = $("y0"), y1 = $("y1");
[y0, y1].forEach((el) => { el.min = atlas.Y0; el.max = atlas.Y1; el.step = 1; });
y0.value = atlas.Y0; y1.value = atlas.Y1;
function syncYearUI() {
  const [a, b] = state.filter.range;
  y0.value = a; y1.value = b;
  const span = atlas.Y1 - atlas.Y0;
  const fill = $("range-fill");
  fill.style.left = `${((a - atlas.Y0) / span) * 100}%`;
  fill.style.right = `${100 - ((b - atlas.Y0) / span) * 100}%`;
  $("year-label").textContent = a === b ? `${a}` : `${a}–${b}`;
}
function onYears(e) {
  let a = +y0.value, b = +y1.value;
  if (a > b) { if (e.target === y0) b = a; else a = b; }
  state.filter.range = [a, b];
  syncYearUI();
  onFilterChange();
}
y0.addEventListener("input", onYears); y1.addEventListener("input", onYears);
$("minp").addEventListener("input", (e) => { state.filter.minPapers = +e.target.value; $("minp-label").textContent = `≥${state.filter.minPapers}`; onFilterChange({ terrain: false }); });
$("minp-label").textContent = "≥1";

let filterTimer = null;
function onFilterChange(opts = {}) {
  sizePins();
  updatePinColors();
  if (opts.terrain !== false) {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => setTerrain(opts.dur ?? 650), opts.immediate ? 0 : 40);
  }
  buildFocusGraphics(false);
  renderPanel();
  renderIntroChips();
  const vis = atlas.nodes.filter((n) => atlas.nodeVisible(n, state.filter)).length;
  $("visible-count").textContent = `${vis} of ${atlas.nodes.length} concepts`;
  const empty = $("empty");
  if (!vis) { empty.hidden = false; empty.textContent = `No papers in ${rangeText()} match these filters. Widen the years, lower the minimum, or turn a type back on.`; }
  else empty.hidden = true;
  dirty = true;
}

// Play: grow the landscape year by year.
let playTimer = null;
function stopPlay() { clearInterval(playTimer); playTimer = null; state.playing = false; $("play").classList.remove("playing"); $("play").textContent = "▶ Grow 1989→2025"; $("year-watermark").hidden = true; }
$("play").addEventListener("click", () => {
  if (state.playing) { stopPlay(); return; }
  state.playing = true;
  $("play").classList.add("playing"); $("play").textContent = "■ Stop";
  let y = atlas.Y0;
  const step = () => {
    state.filter.range = [atlas.Y0, y];
    syncYearUI();
    onFilterChange({ dur: reduceMotion ? 0 : 300, immediate: true });
    const nP = atlas.papersIn(atlas.papers, state.filter).length;
    const wm = $("year-watermark"); wm.hidden = false; wm.innerHTML = `${y}<small>${nP} papers so far</small>`;
    if (y >= atlas.Y1) { setTimeout(stopPlay, 1400); clearInterval(playTimer); playTimer = null; return; }
    y += 1;
  };
  step();
  playTimer = setInterval(step, reduceMotion ? 500 : 340);
});

// ---------- Intro chips ----------
function renderIntroChips() {
  const f = state.filter;
  const regs = regions.map((c) => ({ c, n: new Set(c.members.filter((m) => f.types.has(m.type)).flatMap((m) => atlas.papersIn(m.papers, f).map((p) => p.paper_id))).size })).sort((a, b) => b.n - a.n).slice(0, 4);
  $("chips-regions").innerHTML = regs.map(({ c, n }) => `<button class="chip" data-region="${c.id}" title="${esc(c.name)}"><span class="t">${esc(c.anchor.label)}</span><span class="n">${n}</span></button>`).join("");
  const peaks = atlas.nodes.filter((n) => atlas.nodeVisible(n, f)).sort((a, b) => atlas.countOf(b, f) - atlas.countOf(a, f)).slice(0, 4);
  $("chips-peaks").innerHTML = peaks.map((n) => conceptChip(n, atlas.countOf(n, f))).join("");
  $("chips-peaks").parentElement.hidden = !peaks.length;
  $("chips-regions").parentElement.hidden = !regs.some((x) => x.n);
}
$("intro").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.hasAttribute("data-region")) go({ region: b.dataset.region });
  else if (b.dataset.concept) go({ concept: b.dataset.concept });
});

// ---------- Search ----------
const search = $("search"), results = $("search-results");
let sr = [], srActive = 0;
function renderSearch() {
  const q = search.value;
  sr = atlas.search(q, 8);
  if (!q.trim()) { results.hidden = true; return; }
  results.hidden = false;
  results.innerHTML = sr.length ? sr.map((n, i) => `<div class="sr-item ${i === srActive ? "active" : ""}" data-i="${i}" role="option"><span class="dot" style="background:${atlas.colorOf(n.type)}"></span><span class="lbl">${esc(n.label)}</span><span class="n">${atlas.countOf(n, state.filter)}</span></div>`).join("") : `<div class="sr-empty">No concept matches “${esc(q)}”.</div>`;
}
function pickSearch(i) { const n = sr[i]; if (!n) return; search.value = ""; results.hidden = true; search.blur(); go({ concept: n.id }); }
search.addEventListener("input", () => { srActive = 0; renderSearch(); });
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { srActive = Math.min(sr.length - 1, srActive + 1); renderSearch(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { srActive = Math.max(0, srActive - 1); renderSearch(); e.preventDefault(); }
  else if (e.key === "Enter") { pickSearch(srActive); e.preventDefault(); }
  else if (e.key === "Escape") { search.value = ""; results.hidden = true; search.blur(); e.stopPropagation(); }
});
results.addEventListener("mousedown", (e) => { const it = e.target.closest(".sr-item"); if (it) { e.preventDefault(); pickSearch(+it.dataset.i); } });
search.addEventListener("blur", () => setTimeout(() => { results.hidden = true; }, 120));

// ---------- Mode: 3D / map ----------
function setMode(mode) {
  state.mode = mode;
  $("mode-3d").classList.toggle("on", mode === "3d");
  $("mode-map").classList.toggle("on", mode === "map");
  controls.enableRotate = mode === "3d";
  controls.minPolarAngle = mode === "map" ? 0 : 0.12;
  controls.mouseButtons.LEFT = mode === "map" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.screenSpacePanning = mode === "map";
  terrainMat.uniforms.uFogNear.value = mode === "map" ? 900 : 220;
  terrainMat.uniforms.uFogFar.value = mode === "map" ? 1400 : 520;
  frameRoute({ dur: 900 });
}
$("mode-3d").addEventListener("click", () => setMode("3d"));
$("mode-map").addEventListener("click", () => setMode("map"));

// ---------- About & keyboard ----------
$("about-btn").addEventListener("click", () => { $("about").hidden = false; });
$("about-close").addEventListener("click", () => { $("about").hidden = true; });
$("about").addEventListener("click", (e) => { if (e.target.id === "about") $("about").hidden = true; });
window.addEventListener("keydown", (e) => {
  const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== "range";
  if (e.key === "Escape") {
    if (!$("about").hidden) { $("about").hidden = true; return; }
    if (state.playing) { stopPlay(); return; }
    if (levelOf(state.route) !== "home") go(parentOf(state.route));
    return;
  }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); search.focus(); }
  else if (e.key === "m" || e.key === "M") setMode(state.mode === "map" ? "3d" : "map");
});

// ---------- Boot ----------
renderTypes();
syncYearUI();
sizePins();
heights.set(targetHeights(state.filter));
syncTerrain();
flyHome({ instant: true });
applyRoute({ noFly: true });
{
  const lvl = levelOf(state.route);
  if (lvl !== "home") { viewShift = viewShiftTo; applyRoute(); }
}
onFilterChange({ terrain: false });
requestAnimationFrame(frame);
setTimeout(() => $("loading").classList.add("done"), 150);
window.__terrain = { atlas, state, go, camera, controls, pos2 };
