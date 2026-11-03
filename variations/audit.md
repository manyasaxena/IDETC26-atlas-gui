# Atlas journey audit

*For discussion with Casey · Nov 2026 · base design: `redesign.html` · references: `design_figma/sitemap.png`, `design_figma/inspo-atlas2-variables.png.png`, the four `variations/`*

---

## 1. What Atlas 2 means for the design, in plain terms

**Today, a paper is a list of tags.** Each paper either mentions a concept or doesn't. Two concepts are "connected" when papers mention both. Everything in the UI (the field graph, the orbit, "64 papers measured X during Y") is built on that one fact.

**In Atlas 2, a paper is a filled-in form.** Casey's sheet lists about 57 possible variables. They are grouped four ways:

| Group | Asks | Examples |
|---|---|---|
| **Paper** | who, where, why | authors, region, research question, named theory |
| **Study** | what happened | subject expertise, task individual or team, problem realism, method, setting, time pressure |
| **Measurement** | how it became data | instrument, sample size, validated measure, causal design |
| **Claim** | what was found | finding: independent variable (IV) → dependent variable (DV), direction, strength, hedging, confidence |

Five changes follow for the design:

1. **Nesting.** The four types we have today become *parents*. "Subject" isn't just *Engineering Students* any more. It has kind, expertise, discipline, age, education level and so on. "Problem" has domain, realism, source and openness. So our current concepts become the top of a tree.
2. **Values, not just yes or no.** Variables have different kinds of values:
   - categories, such as setting: lab or field
   - numbers, such as sample size or duration
   - yes or no, such as "hypothesis stated"
   - free text, such as the research question

   Each kind needs a different control and a different chart.
3. **Connections get a direction and a sign.** Today, "X and Y appear together". In Atlas 2, "X *reduced* Y, strongly, in 3 studies; no effect in 1". That's a claim, not a co-mention. The two can disagree, and both matter.
4. **Certainty varies.** Each value is either *recorded* (4 variables, from bibliographic data), *AI-extracted* (31), or *needs human judgment* (22). The UI has to show how much to trust each number, and let people filter on it.
5. **Not everything should become a dot.** "Sample size = 40" and "setting = lab" aren't things you'd orbit around. Some variables are *places* to navigate to (concepts). Most are *lenses*: you filter by them, split by them, and read them in the paper and connection views.

> The core design decision for Atlas 2: **which variables are nodes and which are lenses.** Everything below assumes the four current types (and maybe theory) stay as nodes, and everything else becomes a lens.

---

## 2. Audit of the redesign (`redesign.html`)

Overall, the **concept page is strong and should stay the base**: definition and papers per year on the left, the orbit in the middle, papers and connections on the right. The weak spots are the landing page, getting from one question to the next, and the connection summary.

### Task A: a new PhD student exploring the field

**Works**
- Hovering a dot shows its name, type and definition, and the **? glossary** explains the four types.
- Once you click into a concept, the page is calm and legible. The orbit groups neighbors by type, and the rings say "very related / related / loosely related" in plain words.
- The papers-per-year chart gives a quick sense of history.

**Breaks**
- **The landing is the problem you named:** 228 unlabeled dots and every edge. There's no starting point, no landmarks, and about 30 concepts float loose around the edge with no explanation. They're the ones with no links in the data.
- There's no "what's big / what's new" entry. A newcomer has to know a concept name to search, or click at random.
- Temporal mode only shows the field *up to* a year. It can't show a period such as 2010–2020.

### Task B: a researcher picking a task for their study

**Works**
- From a construct (for example *cognitive fixation*), the Tasks wedge shows which tasks have been used with it, sized by papers. The Connections tab ranks them.
- "Show connections to" can turn off everything except Tasks.

**Breaks**
- **You can only ask about one concept at a time.** A real question is "for *Engineering Students* + *cognitive fixation*, which tasks have been used, and which haven't?" Today you'd have to cross-check two orbits in your head.
- **No gaps:** a combination with zero papers is never shown, but that's often what a researcher is looking for.
- Filters are split up. The "Show connections to" types reset on every new concept, and the field view ignores the concept page's year range. There's also no minimum-papers filter, so one-paper concepts crowd the orbit.

### Task C: someone checking why two concepts are connected

**Works**
- The headline sentence is great: *"64 papers measured cognitive fixation during a concept generation task."*
- The shared papers appear on the year chart in the connection's color, which is nice.
- "What these papers have in common" names other concepts and links to them, and the shared papers are one tab away.
- The compare tray (up to 3) is a good idea.

**Breaks**
- **"29.5% overlap" doesn't mean much to a reader.** Is that a lot? Saying "2× more often than chance", as the variations did, answers the real question.
- **The common-ground summary is one long paragraph** of about 120 words. It has the right facts in it but is hard to scan.
- **Connection and paper views have no URL and aren't in the breadcrumb**, so you can't share them, and browser Back skips over them.
- The paper page has "Summary coming soon" and a disabled original-paper link.
- Some paper titles in the data are wrong ("*Corresponding author: …", "1 Copyright © 2007 by ASME").

### What breaks once Atlas 2's variables arrive

| Part | Today | With Atlas 2 |
|---|---|---|
| **Field graph** | already overwhelming | worse: more nodes, and no way to show values or findings |
| **Type pills and "Show connections to" checkboxes** | 4 items | ~57 variables in 4 groups, many with many values, so a flat checkbox list stops working |
| **Orbit wedges** | 4 type slices | fine *if* only the four types stay nodes; unworkable if variables become wedges |
| **Orbit rings ("relevance")** | co-mention strength | can't show direction (increase or reduce), strength, or disagreement |
| **Connection summary** | "N papers studied both" | the most important thing changes to *what was found*: direction, strength, evidence quality and certainty |
| **Paper page** | a list of concept chips | needs a structured study card with 4 groups, values, and a certainty mark on each |
| **Year chart** | papers per year | still useful, and could be split by any variable (for example lab vs field over time) |

---

## 3. The variations: quick assessment

**Why they felt hard to navigate.** Each one asked you to learn a new world (galaxies, terrain, layers, rivers) *before* you got to a concept. None of them kept your concept page as a stable home base. Two of them, Star Systems and Terrain, are organized by groups an algorithm computed, which have awkward names no researcher would recognize. **The lesson: depth should come from the concept page and its panels, not from a new space you have to travel through.**

| Variation | Worth borrowing | What made it hard | Scales to Atlas 2? |
|---|---|---|---|
| **Star Systems** | full breadcrumb (galaxy › system › concept › connection › paper); minimap "you are here"; a calm landing with ~15 named landmarks | two extra levels (galaxy, system) before you reach a concept; computed group names | **Low.** Groups can't show values or findings. |
| **Terrain** | the "Grow 1989→2025" animation as a one-time orientation moment | 3D camera, hidden labels, a ground layout that means little to readers | **Lowest.** Height can only show one number. |
| **Strata** | **narrowing by picking concepts (601 → 337 → 130 → 53 papers)**; "0 papers: possible gap"; the paper's concepts shown layer by layer | tilted planes overlap; one pick per layer; a dense screen | **The idea scales best.** "Pick values, watch the papers narrow" is exactly how filtering over 57 variables should feel. The stacked-plane visual doesn't scale. |
| **Time River** | the connection view: "2× more often than chance" plus shared papers as dots on a timeline; the year brush on the time axis | an unfamiliar chart form; the concept view gets busy | **Medium.** Time is a good axis for any variable, but it's a lens, not the main way around. |

---

## 4. Recommendation: evolve the redesign for Atlas 2

Keep the three-panel concept page as home. Change what feeds it.

### 4.1 Landing: an entry point, not the whole graph
- Replace the force graph with a **small set of landmarks**: the biggest concepts in each type, what's rising, and a search. The four-layer entry from Strata, kept flat and simple, is a good model.
- Keep the full graph as an optional "see everything" view.
- Explain the unlinked concepts honestly, or leave them off the map.

### 4.2 Filters become one shared, nested panel
- **One global filter panel** that stays with you on every page (not reset per concept). It's grouped as **Paper / Study / Measurement / Claim → variable → values**, all collapsed by default, with counts next to every value.
- **The right control for each kind of variable:** checkboxes for categories, a range for numbers (sample size, year), and a toggle for yes or no.
- **Active filters show as chips** along the top ("Novices × Lab setting × 2010–2025 ✕"), so you always know why you're seeing what you're seeing.
- **A certainty filter** with three choices: recorded / AI-extracted / human-judged. The default shows all of them, marked.
- **Picking values narrows the papers**, Strata-style: a running count ("53 papers match"), and when nothing matches, *"0 papers: possible gap"*. This answers Task B directly.

### 4.3 Nesting in the orbit
- **Wedges stay the four types.** Variables do *not* become dots.
- **Add a "Split by" control:** choose a variable (for example *subject expertise*) and each orbit node, and the papers chart, splits into its values, as a small ring or stacked bar. That's how nested detail appears without new nodes.
- **Concepts with children can expand in place.** For example, *Engineering Students* expands to *novice* and *experienced* sub-dots. Click again to collapse.
- **Add a ring-meaning switch:** "Studied together" (today) or "Findings" (Atlas 2). In Findings mode, lines get **direction (arrow) and sign** (↑ increased, ↓ reduced, ○ no effect, ± mixed).

### 4.4 Connections in depth: an evidence card instead of a paragraph
Replace the summary paragraph with a scannable card. For example:

```
Cognitive fixation ↔ concept generation task
64 papers studied both · 2× more often than chance

What was found                  (only Atlas 2 data)
  ↓ reduced fixation    9 studies   ■■■■■■■■■
  ○ no effect           3           ■■■
  ↑ increased           1           ■
Evidence    median sample 42 · 5 experimental (causal) designs
Certainty   6 human-checked · 7 AI-extracted
Holds when  students ✓ / practitioners ? · lab ✓ / field —
When        ●●  ● ●●● ●●●●●●  (dots by year)
Also in these papers   Engineering Students (53) · analogical reasoning (20) …
Papers      grouped by finding, each with its claim sentence and certainty mark
```

- **"Holds when"** goes deeper than "these two are related". It breaks the findings down by study variables, so you see *under what conditions* they hold.
- **Disagreement is shown, not averaged away.**
- Every number can be clicked through to the papers behind it.

### 4.5 Paper page: a structured study card
- Four sections (Paper / Study / Measurement / Claim). Every value carries a small certainty mark: recorded, AI, or checked by a person.
- Findings appear as sentences: *"Using a priming activity **reduced** fixation (moderate; hedged)."*

### 4.6 Navigation fixes worth doing now, regardless of Atlas 2
- Give connections and papers their own URL and breadcrumb (`Atlas › Cognitive fixation › ↔ Concept generation task › Paper`), and make browser Back step out of them.
- Add a minimum-papers filter, and make filters (types, years) the same on the field and the concept pages.
- Replace "29.5% overlap" with "N× more often than chance".
- Show the shared papers as dots on a timeline (from Time River).

### 4.7 One consistent way to show certainty
Use the same three marks everywhere: values, counts, chips and paper cards. For example, solid = recorded, dashed = AI-extracted, ✓ = checked by a person. In summaries, say it in words: "13 findings (6 checked by a person)".

---

## 5. Questions for Casey

**What the data will be**
1. **Is the unit a paper or a study?** Many papers report several studies with different subjects and findings. Do variables and findings belong to the paper or to each study?
2. **Which variables are things to navigate to, and which are filters?** Do subject, task, problem and construct stay the main "nodes"? Does *theory* become one?
3. **Fixed lists or free text?** Will values come from controlled vocabularies, maybe hierarchies (for example a construct taxonomy), or be extracted free-form? Nesting needs fixed lists.
4. **Findings:** what's the shape? Is it always IV → DV with direction and strength on a fixed scale? Can a finding link any two variables, or mainly study conditions → constructs?
5. **Certainty:** is it per value or per variable? Will human-judged items record who checked them and whether reviewers agreed? Should unchecked AI values be **visible to the public by default**?

**What the site is for**
6. **Who is the main user, and what's their question?** Mapping the field ("what's been studied") or synthesizing evidence ("what do we know about X → Y")? That decides whether the landing page or the connection page deserves the most effort.
7. **Should "studied together" stay** once findings exist, or do findings replace it?
8. **Should evidence quality** (sample size, causal design) *weight* connections, or only be shown?

**How to move forward**
9. **Which variables are "in" first?** The sheet has in / maybe / out boxes. A first release with about 10 variables is very different to design for than one with 57.
10. **Can we get 5–10 hand-coded papers in the Atlas 2 format** to prototype against, including at least one with conflicting findings?
