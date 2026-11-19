"""Build map_groups.json for the Map view and terrain-v2.html.

Computes two of the four "Group by" modes once, from graph_data.json, so both views place concepts the same way:

  together  Neighborhoods of concepts that share many papers: Louvain community detection on the links,
            weighted by shared papers ÷ √(papers of A × papers of B) so the biggest concepts don't pull
            everything into one group.
  meaning   Concepts placed by how similar their definitions are: TF-IDF of each concept's label and
            description, cosine similarity, a 2D layout (classical MDS) and groups from k-means.

"type" needs no file, and "families" (topic families) are hand-written suggestions in suggested_groups.json.
Placeholder concepts and same-type (flagged) links are left out, as in the paper. graph_data.json is not changed.

Group names come from NAMES below, keyed by each group's most-studied member; a group without an entry is
named after its top concepts and reported, so names can be written for it. Run:  python3 tools/build_map_groups.py
Needs only numpy.
"""
import json, math, re, datetime, os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
g = json.load(open(os.path.join(ROOT, "graph_data.json")))
nodes = [n for n in g["nodes"] if not n.get("is_placeholder")]
ids = [n["id"] for n in nodes]
idx = {i: k for k, i in enumerate(ids)}
node = {n["id"]: n for n in nodes}
count = {n["id"]: len(n["papers"]) for n in nodes}

# ---------- links: one per pair, papers merged across edge types; same-type links are extraction errors ----------
pair_papers = {}
for e in g["edges"]:
    a, b = e["source"], e["target"]
    if a not in idx or b not in idx or node[a]["type"] == node[b]["type"]:
        continue
    key = tuple(sorted((a, b)))
    pair_papers.setdefault(key, set()).update(p["paper_id"] for p in e["papers"])
links = [(a, b, len(ps)) for (a, b), ps in pair_papers.items()]

# ---------- Studied together: Louvain on normalized weights ----------
def louvain(n, edges, seed=7, resolution=1.0):
    """Plain Louvain (local moves + aggregation). edges: list of (i, j, w). Returns a community per node."""
    rng = np.random.default_rng(seed)
    comm_of = list(range(n))           # final community of each original node
    members = [[i] for i in range(n)]  # original nodes inside each current super-node
    cur_edges = edges
    cur_n = n
    while True:
        adj = [dict() for _ in range(cur_n)]
        for i, j, w in cur_edges:
            if i == j:
                adj[i][i] = adj[i].get(i, 0) + w
            else:
                adj[i][j] = adj[i].get(j, 0) + w
                adj[j][i] = adj[j].get(i, 0) + w
        deg = np.array([sum(a.values()) + a.get(k, 0) for k, a in enumerate(adj)], dtype=float)
        m2 = deg.sum() or 1.0
        com = list(range(cur_n))
        tot = deg.copy()
        moved_any, improved = False, True
        while improved:
            improved = False
            for i in rng.permutation(cur_n):
                ci = com[i]
                links_to = {}
                for j, w in adj[i].items():
                    if j != i:
                        links_to[com[j]] = links_to.get(com[j], 0) + w
                tot[ci] -= deg[i]
                best, best_gain = ci, links_to.get(ci, 0) - resolution * tot[ci] * deg[i] / m2
                for c, w in links_to.items():
                    gain = w - resolution * tot[c] * deg[i] / m2
                    if gain > best_gain + 1e-12:
                        best, best_gain = c, gain
                tot[best] += deg[i]
                if best != ci:
                    com[i] = best
                    improved = moved_any = True
        if not moved_any:
            break
        relabel = {c: k for k, c in enumerate(sorted(set(com)))}
        new_members = [[] for _ in relabel]
        for s, c in enumerate(com):
            new_members[relabel[c]].extend(members[s])
        agg = {}
        for i, j, w in cur_edges:
            key = (relabel[com[i]], relabel[com[j]])
            agg[key] = agg.get(key, 0) + w
        members, cur_edges, cur_n = new_members, [(i, j, w) for (i, j), w in agg.items()], len(relabel)
    for c, ms in enumerate(members):
        for i in ms:
            comm_of[i] = c
    return comm_of

cos_w = [(idx[a], idx[b], k / math.sqrt(count[a] * count[b])) for a, b, k in links]
comm = louvain(len(ids), cos_w)
linked = {i for a, b, _ in links for i in (a, b)}
together = {}
for i, c in zip(ids, comm):
    together.setdefault(("none" if i not in linked else c), []).append(i)
# Fold tiny neighborhoods (under 3 concepts) into the neighborhood they share the most papers with.
def strength(i, group):
    s = set(group)
    return sum(k for a, b, k in links if (a == i and b in s) or (b == i and a in s))
changed = True
while changed:
    changed = False
    small = [c for c, ms in together.items() if c != "none" and len(ms) < 3]
    for c in small:
        others = {o: ms for o, ms in together.items() if o not in (c, "none")}
        if not others:
            break
        target = max(others, key=lambda o: sum(strength(i, others[o]) for i in together[c]))
        together[target].extend(together.pop(c))
        changed = True
        break

# ---------- Similar meaning: TF-IDF of label + description ----------
STOP = set("""a an the of and or in on to for with by as at from into than that this these those is are was were be been being
it its their them they which who whom whose what when where how such any all each other others both either not no nor only own
same so very can will may might must should would could also using used use uses study studies studied involving involve involves
including include includes based between within across among during participants subjects subject task tasks problem problems
construct constructs design designs designer designers designing researchers research""".split())
def stem(w):
    for suf in ("ations", "ation", "ings", "ing", "ities", "ity", "ness", "ments", "ment", "ies", "es", "s", "ed", "al"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w
def tokens(n):
    text = f"{n['label']} {n['label']} {n.get('description') or ''}".lower()
    return [stem(w) for w in re.findall(r"[a-z][a-z\-]+", text) if w not in STOP]
docs = [tokens(n) for n in nodes]
vocab = sorted({w for d in docs for w in d})
vi = {w: k for k, w in enumerate(vocab)}
tf = np.zeros((len(docs), len(vocab)))
for r, d in enumerate(docs):
    for w in d:
        tf[r, vi[w]] += 1
df = (tf > 0).sum(0)
# Words in more than 8% of definitions ("product", "process", "measure"...) say little about meaning; words in only
# one can't link two concepts. Both are dropped.
keep = (df >= 2) & (df <= 0.08 * len(docs))
tf, df = tf[:, keep], df[keep]
X = (1 + np.log(np.maximum(tf, 1))) * (tf > 0) * np.log((1 + len(docs)) / (1 + df))[None, :]
X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-12
S = X @ X.T

def spherical_kmeans(X, k, seed=3, iters=60):
    rng = np.random.default_rng(seed)
    C = [X[rng.integers(len(X))]]
    for _ in range(1, k):  # k-means++ on cosine distance
        d = 1 - np.max(np.stack([X @ c for c in C]), axis=0)
        C.append(X[rng.choice(len(X), p=np.maximum(d, 0) / np.maximum(d, 0).sum())])
    C = np.stack(C)
    for _ in range(iters):
        lab = np.argmax(X @ C.T, axis=1)
        newC = np.stack([X[lab == j].sum(0) if (lab == j).any() else C[j] for j in range(k)])
        newC /= np.linalg.norm(newC, axis=1, keepdims=True) + 1e-12
        if np.allclose(newC, C):
            break
        C = newC
    return lab

K_MEANING = 9
mlab = spherical_kmeans(X, K_MEANING)
meaning = {}
for i, c in zip(ids, mlab):
    meaning.setdefault(int(c), []).append(i)
# 2D positions: classical MDS on cosine distance.
D2 = (1 - S) ** 2
J = np.eye(len(ids)) - 1 / len(ids)
B = -0.5 * J @ D2 @ J
vals, vecs = np.linalg.eigh(B)
top = np.argsort(vals)[::-1][:2]
Y = vecs[:, top] * np.sqrt(np.maximum(vals[top], 0))
Y = (Y - Y.mean(0)) / (np.abs(Y).max() or 1)
coords = {i: [round(float(Y[k, 0]), 4), round(float(Y[k, 1]), 4)] for k, i in enumerate(ids)}

# ---------- names ----------
NAMES = json.load(open(os.path.join(os.path.dirname(__file__), "map_group_names.json")))
missing = []
def name_groups(mode, groups):
    out = []
    for key, ms in groups.items():
        ms = sorted(ms, key=lambda i: -count[i])
        anchor = node[ms[0]]["label"]
        if key == "none":
            name = "No shared papers with others yet"
        else:
            name = NAMES.get(mode, {}).get(anchor)
            if not name:
                name = ", ".join(node[i]["label"] for i in ms[:3])
                missing.append((mode, anchor, [node[i]["label"] for i in ms[:8]], len(ms)))
        out.append({"id": f"{mode}-{len(out)}", "name": name, "anchor": anchor, "members": ms})
    return sorted(out, key=lambda grp: -sum(count[i] for i in grp["members"]))

out = {
    "generated": datetime.date.today().isoformat(),
    "about": "Groupings for the Map view and terrain-v2.html, built by tools/build_map_groups.py from graph_data.json. "
             "'together': Louvain communities on links weighted by shared papers ÷ √(papers A × papers B). "
             "'meaning': TF-IDF of each concept's label and description; groups by k-means, positions by classical MDS "
             "of cosine distance. Group names are written by hand (AI-suggested) in tools/map_group_names.json. "
             "Placeholder concepts and same-type links are left out.",
    "modes": {
        "together": {"groups": name_groups("together", together)},
        "meaning": {"groups": name_groups("meaning", meaning), "coords": coords},
    },
}
json.dump(out, open(os.path.join(ROOT, "map_groups.json"), "w"), indent=1, ensure_ascii=False)
for m in missing:
    print("UNNAMED", m)
print({k: len(v["groups"]) for k, v in out["modes"].items()})
