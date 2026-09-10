"""Optional CPU-only evaluation. Dependencies live in a disposable venv, never the app."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
MODEL_SHA = "b941bf19f1f1283680f449fa6a7336bb5600bdcd5f84d10ddc5cd72218a0fd21"
STOP = set("a an and are as at be by can do for from how i in is it my of on or the this to was what when where with you your".split())
CASES = [
    ("ask-jackalope", ["What can Ask Jackalope change?", "Can the companion answer questions without a project open?", "How do I stop sending appearance information to the helper?"]),
    ("git-worktrees", ["How do Git worktrees isolate tasks?", "Can two agents change the same repo at once?", "Where do I review and merge a task branch?"]),
    ("task-routing-and-quotas", ["How does automatic routing choose an agent?", "What happens when my agent runs out of allowance?", "Does an unknown quota mean I have unlimited capacity?"]),
    ("multi-account-and-agents", ["How do I add a second Claude account?", "Can I keep work and personal logins separate?", "Does changing accounts affect existing sessions?"]),
    ("mcp-and-browser-automation", ["How do I enable the built in browser for a project?", "Can an agent click through a web page?", "Where can I inspect screenshots from browser tools?"]),
    ("windows-desktop-control", ["How do I grant Windows desktop control?", "Can I interrupt an agent moving the mouse?", "Can the agent interact with a native app window?"]),
    ("troubleshooting-and-diagnostics", ["How do I diagnose a stopped or failed task?", "Where do I find diagnostics for a run that failed?", "The task stopped unexpectedly. What should I inspect?"]),
    ("fixing-cli-path-on-windows", ["How do I fix CLI not found on Windows?", "My terminal finds the agent but Jackalope does not", "Where should I put an executable override?"]),
    ("resolving-git-worktree-locks", ["How do I resolve a Git index.lock?", "Git says another process is using this worktree", "A stale lock blocks my branch cleanup. How do I keep my changes?"]),
    ("connecting-custom-mcp-servers", ["How do I connect a custom MCP server?", "Can I supply environment variables to a stdio tool server?", "How do I configure HTTP transport for a tool connection?"]),
    ("recurring-schedules-and-automation", ["How do I set up a recurring task?", "Can I notify about committed changes without running an agent?", "Will scheduled work run while my computer is asleep?"]),
    ("task-composer-and-effort-levels", ["Where do I choose task effort?", "How do I write and review my first task?", "Can I prepare a draft before launching work?"]),
    ("theme-editor-and-atmosphere", ["How do I change atmosphere and accent colors?", "Can I give one project a different appearance?", "How do I cancel a theme preview?"]),
]

def terms(text):
    return [t for t in re.split(r"[^\w]+", text.lower()) if len(t) > 1 and t not in STOP]

def bm25(query, documents):
    counts = [collections.Counter(terms(d)) for d in documents]
    lengths = [sum(c.values()) for c in counts]
    avg = max(sum(lengths) / len(lengths), 1)
    scores = [0.0] * len(documents)
    for term in set(terms(query)[:64]):
        df = sum(term in d for d in counts)
        idf = math.log(1 + (len(documents) - df + .5) / (df + .5))
        for i, c in enumerate(counts):
            tf = c[term]
            scores[i] += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * lengths[i] / avg))
    return sorted(range(len(scores)), key=lambda i: (-scores[i], i))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="scratch/minilm-eval/result.json")
    args = parser.parse_args()
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    folder = ROOT / "scratch/minilm-eval/model"
    folder.mkdir(parents=True, exist_ok=True)
    for remote, local in [("onnx/model_quint8_avx2.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json")]:
        path = folder / local
        if not path.exists():
            urllib.request.urlretrieve(f"https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/{REVISION}/{remote}", path)
    assert hashlib.sha256((folder / "model.onnx").read_bytes()).hexdigest() == MODEL_SHA
    docs = json.loads((ROOT / "packages/knowledge/catalog.json").read_text(encoding="utf-8"))
    chunks, owners = [], []
    for i, doc in enumerate(docs):
        heading = doc["title"]
        for paragraph in doc["markdown"].split("\n\n"):
            if paragraph.startswith("#"):
                heading = paragraph.lstrip("#").strip()
            if not paragraph.strip() or paragraph.startswith("https://") or len(paragraph.encode()) > 2400:
                continue
            chunks.append(f'{doc["title"]} {heading} {paragraph}')
            owners.append(i)
    tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=256)
    tokenizer.enable_padding()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    started = time.perf_counter()
    session = ort.InferenceSession(str(folder / "model.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    startup_ms = (time.perf_counter() - started) * 1000
    def encode(texts):
        batch = tokenizer.encode_batch(texts)
        inputs = {"input_ids": np.array([b.ids for b in batch], dtype=np.int64), "attention_mask": np.array([b.attention_mask for b in batch], dtype=np.int64), "token_type_ids": np.array([b.type_ids for b in batch], dtype=np.int64)}
        output = session.run(None, inputs)[0]
        mask = inputs["attention_mask"][..., None]
        pooled = (output * mask).sum(1) / mask.sum(1).clip(1)
        return pooled / np.linalg.norm(pooled, axis=1, keepdims=True).clip(1e-9)
    started = time.perf_counter()
    vectors = np.concatenate([encode(chunks[i:i+16]) for i in range(0, len(chunks), 16)])
    index_ms = (time.perf_counter() - started) * 1000
    rows, latencies = [], []
    for slug, queries in CASES:
        for query in queries:
            old = sorted(range(len(docs)), key=lambda i: -sum(5 * (t in (docs[i]["title"] + " " + docs[i]["slug"]).lower()) + (t in docs[i]["markdown"].lower()) for t in query.lower().split()))
            lexical = bm25(query, chunks)
            started = time.perf_counter()
            scores = vectors @ encode([query])[0]
            latencies.append((time.perf_counter() - started) * 1000)
            semantic = sorted(range(len(chunks)), key=lambda i: -scores[i])
            def dedup(indices):
                return list(dict.fromkeys(docs[owners[i]]["slug"] for i in indices))
            rankings = {"current": [docs[i]["slug"] for i in old], "bm25": dedup(lexical), "minilm": dedup(semantic)}
            rows.append({"query": query, "expected": slug, "rank": {k: v.index(slug)+1 for k, v in rankings.items()}, "top3": {k:v[:3] for k,v in rankings.items()}})
    metrics = {name: {"top1": sum(r["rank"][name] == 1 for r in rows)/len(rows), "recallAt3": sum(r["rank"][name] <= 3 for r in rows)/len(rows), "mrr": sum(1/r["rank"][name] for r in rows)/len(rows)} for name in ["current", "bm25", "minilm"]}
    native_files = list(Path(ort.__file__).parent.rglob("*.dll"))
    result = {"scope": "39 authored guide-retrieval queries, 13 bundled guides. Not production queries, answer quality, or measured provider token savings.", "modelRevision": REVISION, "modelSha256": MODEL_SHA, "modelBytes": (folder/"model.onnx").stat().st_size, "tokenizerBytes": (folder/"tokenizer.json").stat().st_size, "onnxRuntimeDllBytes":sum(p.stat().st_size for p in native_files), "startupMs": startup_ms, "indexMs": index_ms, "chunks": len(chunks), "queryMedianMs": statistics.median(latencies), "queryP95Ms": sorted(latencies)[int(.95*len(latencies))], "metrics":metrics, "cases":rows}
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({k:v for k,v in result.items() if k != "cases"}, indent=2))

if __name__ == "__main__":
    main()
