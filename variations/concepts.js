// Content for the comparison page (index.html): one entry per concept, plus the recommendation.
const CONCEPTS = [
  {
    folder: "star-systems",
    name: "Star Systems",
    tag: "2.5D · from your solar-system idea",
    pitch: "The field is a galaxy of neighborhoods, groups of concepts studied together. You travel inward: galaxy › system › concept › connection › paper.",
    space: ["Star = a neighborhood", "Closer stars = more papers in common", "Orbit distance = how tightly a concept belongs", "Size = papers"],
    startedFrom: "Your planets and solar-system idea. Neighborhoods are found from the data (community detection on shared papers), so each star is a real cluster of research, not a type.",
    doesWell: "The calmest landing of the four: about 15 labelled stars and a few “trade routes”, so you can name the field's parts in seconds. Inside a system every label is readable, and “gateways” at the edge point toward neighboring systems. In a concept, its strongest connections become moons, with a dashed ring marking moons from other systems. The galaxy minimap always shows where you are.",
    costs: "Depth is only a visual cue (tilt, size, parallax) and carries no data. Galaxy distances come from a force layout, so they are approximate. Neighborhood names are generated from their two most central concepts, so some read awkwardly (“General Public & trust”). The 29 concepts with no links sit apart as “drifting debris”.",
    tasks: {
      explore: "Strongest of the four: read the galaxy, open the biggest star, follow a route to a neighbor. The field arrives as about 15 named neighborhoods instead of 228 dots.",
      pick: "Open a system, filter to Tasks, and compare tasks by size and how central they sit. You can't easily compare tasks across the whole field at once.",
      why: "A good connection view: the plain sentence, “5.3× more often than chance”, each concept's share, what else those papers study, and the papers on a year line."
    }
  },
  {
    folder: "terrain",
    name: "Terrain",
    tag: "true 3D · from your landscape idea + 3dvis",
    pitch: "A dark topographic map: concepts studied together sit close on the ground, and the land rises wherever papers pile up. Press Grow and watch 36 years of research build the mountains.",
    space: ["Ground distance = studied together", "Height = papers concentrated there", "Pin = a concept", "Arc = shared papers"],
    startedFrom: "Your landscape idea and the 3dvis image (pins on stalks above a surface), reinterpreted as a contour map in the dark Atlas style. It is the honest test of real 3D.",
    doesWell: "The most atmospheric of the four, and the one that best conveys “where the weight of the field is”. “Grow 1989→2025” is the single strongest moment across all concepts: you watch peaks rise. The type filter rebuilds the land, so “constructs only” is a different landscape. Valleys beside a peak suggest under-studied ground near busy topics.",
    costs: "This is where 3D costs the most. Mountains hide pins and labels; about a third of region names drop out at landing; in the connection view a nearby mountain can fill the frame. The mitigations are Map view (M), labels that hide behind terrain, and a constrained camera, but orbiting is still extra work. Height is √papers (rank more than size), the layout is approximate, and it is the heaviest on a weak GPU.",
    tasks: {
      explore: "Good for a first impression (big ranges, region names, the grow animation), weaker for systematic browsing, because things hide behind each other.",
      pick: "Filter to Tasks only and read the peaks; the valleys next to a peak are candidate gaps. Reading exact numbers needs the panel.",
      why: "The same full explanation panel (sentence, counts, lift, trend, what else, papers). The arc in the 3D scene adds little and is sometimes hard to frame."
    }
  },
  {
    folder: "strata",
    name: "Strata",
    tag: "2.5D layers · from your layers idea + space-vis",
    pitch: "The four types are four stacked layers that read as the anatomy of a study: who is studied → what they do → what they work on → what is measured. You drill a core sample down through them, and it holds the real papers.",
    space: ["Layer = part of a study", "Left → right = median year of a concept's papers", "Depth = neighborhood", "Size = papers", "Thread = shared papers"],
    startedFrom: "Your “layers in space” idea and the stacked planes in the space-vis image. The surprise was making the layers mean a study design rather than just a type.",
    doesWell: "It is the only concept that answers “what can I study?” directly. Each pick narrows the sample (601 → 337 → 130 → 53 papers) and suggests the most common next step in each remaining layer. A combination with 0 papers is flagged as a possible research gap, with the nearest combinations that do have papers. The paper view shows each paper's “core”, its concepts layer by layer.",
    costs: "The tilted planes compress depth, so dots overlap (hover labels and the Flat toggle help). The chain holds one concept per layer. Same-layer links (construct + construct) are only reachable from the panel. Threads show the top 10 per layer. It suits a goal-driven visitor better than an aimless one.",
    tasks: {
      explore: "The landing teaches the vocabulary (what a subject, task, problem and construct are) with three landmarks per layer. It is a little less inviting for pure wandering.",
      pick: "By far the strongest: pick a population and a construct, read the most common tasks among the matching papers, and see when a combination is a gap.",
      why: "Click any thread for the sentence, share of each, strength against chance, trend, what else those papers study, and the papers."
    }
  },
  {
    folder: "time-river",
    name: "Time River",
    tag: "flat 2D · my own idea",
    own: true,
    pitch: "The Atlas as a watershed in time. Each concept is a stream that rises the year it was first studied and widens with its papers; four channels, one per type. Flat on purpose: nothing hides behind anything.",
    space: ["Left → right = 1989 → 2025", "Stream width = papers per year", "Channel = type", "Dot = a shared paper, at its year"],
    startedFrom: "Not your suggestions or the mood images: a deliberate counterpoint to the 3D ideas, asking what you see if time, not topology, is the main axis.",
    doesWell: "It shows what a network hides: when a topic started, peaked, or faded, and when two topics met (the shared papers as dots on the timeline). Landmarks are computed: the biggest stream per channel plus rising topics (Large Language Model, trust). The year filter is a brush on the time axis itself, the most natural year control of the four. Every label is readable.",
    costs: "It loses network structure: you only see who connects to whom one concept at a time, and neighborhoods don't exist here. Stream width counts mentions (a paper with two tasks counts twice), and 3-year smoothing blurs single years. The concept view gets busy with very common pairs, and the “unfold all” view of a 70–80-stream channel is dense.",
    tasks: {
      explore: "Strong for the field's history: four channels, a handful of landmarks, then open a channel to see what grew and when.",
      pick: "Good for timing: which tasks are rising or fading, narrowed with the brush. Weaker for combining a task with a population and construct (Strata does that).",
      why: "The best “why” of the four: the sentence and lift in plain words, plus a timeline of exactly when the two topics met."
    }
  }
];

const VERDICT = `
  <h2>What I'd pick: Star Systems as the spine, Strata as the second mode</h2>
  <p><b>Star Systems</b> is the clearest answer to “data vomit”. Its landing names the field's parts in about 15 readable landmarks, the space means something you can say in one sentence, and the journey inward (galaxy › system › concept) keeps you oriented with the minimap and breadcrumb. It's 2.5D, so it keeps the feeling of depth from your mood images without paying for real 3D in hidden labels.</p>
  <p>I'd combine it with three pieces from the others:</p>
  <ul>
    <li><b>From Strata, a “Design a study” mode.</b> The core sample (pick a subject, task, problem or construct and watch the papers narrow, with gaps flagged) is the most useful thing any of the four does for a researcher. It's a different question from “what's in the field”, so it works best as a second mode one click away from any concept, not as the landing.</li>
    <li><b>From Time River, the connection view.</b> “Studied together 2× more often than chance”, plus the shared papers as dots on a timeline, is the clearest answer to “why are these connected?”. The year-axis brush is also a better year filter than a slider.</li>
    <li><b>From Terrain, the Grow animation.</b> Watching the field build from 1989 to 2025 is the most memorable moment of all four. On the galaxy it could become a temporal mode (stars ignite and swell as their papers appear) without the cost of 3D.</li>
  </ul>
  <p>I wouldn't make <b>Terrain</b> the main view. It's beautiful at first sight, but it showed the 3D tradeoffs clearly: occlusion, dropped labels, camera work, and a ground layout that is only approximate. It's best as a showpiece or poster image.</p>

  <div class="scroll"><table>
    <tr><th></th><th>Landing</th><th>Space means</th><th>Orientation</th><th>PhD student</th><th>Picking a task</th><th>Why connected</th></tr>
    <tr><td>Star Systems</td><td>~15 neighborhoods</td><td>clear, approximate distances</td><td>breadcrumb + minimap</td><td>★★★</td><td>★★</td><td>★★</td></tr>
    <tr><td>Terrain</td><td>ranges + peaks</td><td>evocative, occluded</td><td>3D camera + Map view</td><td>★★</td><td>★★</td><td>★★</td></tr>
    <tr><td>Strata</td><td>4 layers, 3 landmarks each</td><td>exact: layers + year</td><td>chain as breadcrumb</td><td>★★</td><td>★★★</td><td>★★</td></tr>
    <tr><td>Time River</td><td>4 channels + landmarks</td><td>exact: time + width</td><td>breadcrumb, all visible</td><td>★★</td><td>★★</td><td>★★★</td></tr>
  </table></div>

  <p style="color:var(--muted);margin-top:18px">Shared across all four: <code>shared/atlas-core.js</code> (data, filters, search, neighborhoods and connection explanations), so the numbers agree everywhere. Data notes found along the way: 29 concepts have no links in graph_data.json (the export deliberately unlinks “no design object” and “multi-phase design process”); edge <code>weight</code> doesn't always equal the paper count, so the paper lists are used; and some paper titles are wrong in the source (for example “1 Copyright © 2007 by ASME” or “*Corresponding author: …”).</p>
`;
