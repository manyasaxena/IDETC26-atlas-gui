# Towards an Atlas of Design Problems, Tasks, and Cognitive Constructs in DTM

This is a working prototype of the Design Engineering Atlas — an interactive knowledge graph of the empirical science-of-design-engineering literature, built in support of a paper currently under review for ASME IDETC 2026.

**[Explore the prototype →](https://caseysimoneb.github.io/IDETC26-atlas-gui/preview.html)**

---

## About the Atlas

The Design Engineering Atlas maps the structure of the empirical DTM literature as a network of subjects, tasks, problems, and cognitive constructs. Every node is a concept extracted from the literature. Every edge is a co-occurrence — two concepts that appear together across the same papers.

The graph was extracted from 36 years of ASME Design Theory and Methodology (DTM) conference proceedings (1989–2025) using a multi-stage LLM pipeline.

| | |
|---|---|
| Nodes | 228 |
| Edges | 1,959 |
| Papers | 1,548 total · 601 empirical |
| Temporal range | 1989–2025 |

---

## Node types

| Color | Type | Count | Definition (the paper's working definitions) |
|---|---|---|---|
| Blue | Subjects | 12 | Any agent (human, AI, or machine) whose behavior in performing the task the study was designed to observe |
| Green | Tasks | 70 | An activity with a definable input and output that the study exists, at least in part, to watch happen; what subjects do, not what researchers do with the results |
| Amber | Problems | 80 | The concrete brief or prompt given to subjects to work on, the thing they are asked to design or solve |
| Purple | Cognitive Constructs | 66 | A mental process or psychological state occurring within the subject that would exist as a meaningful phenomenon in cognitive psychology independent of any design context |

---

## How to explore

- **Click any node** to see its connections and the papers behind them
- **Search** by node name using the top bar
- **Filter** by node type using the colored pills
- **Adjust** the edge weight slider to show only stronger connections
- **Temporal mode** traces the graph's growth from 1989 to present

---

## Authors

**Caseysimone Ballestas** (PhD Student) and **Dr. Kosa Goucher-Lambert** (Advisor)
UC Berkeley, Mechanical Engineering

*Working paper under review, ASME IDETC 2026.*

---

## Repository

| File | Description |
|---|---|
| `preview.html` | Standalone prototype visualization |
| `graph_data.json` | Pre-exported graph data |
| `export_graph.py` | Script that generated the JSON from the underlying database |
| `PRD.md` | Full product requirements for the visualization |
