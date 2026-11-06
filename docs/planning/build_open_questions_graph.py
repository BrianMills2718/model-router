#!/usr/bin/env python3
"""Write open-questions.graph.json (typed-graph/v1) from open-questions.json.

The map answers: which decisions are still waiting on an open question, whose
call each question is, and which domain concepts (from domain.graph.json) it
bears on. Resolved questions stay in the ledger but are not drawn.

Run: python3 docs/planning/build_open_questions_graph.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _short(text: str, limit: int = 90) -> str:
    """Cut a long label at a word boundary and mark the cut with an ellipsis."""
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + " …"


def main() -> None:
    ledger = json.loads((HERE / "open-questions.json").read_text())
    domain = json.loads((HERE / "domain.graph.json").read_text())
    concepts = {n["id"]: n for n in domain["nodes"]}

    graph = {
        "schema": "typed-graph/v1",
        "kinds": {
            "AgentQuestion": {
                "label": "Agent question (checking can settle it)",
                "color": "#3b7dd8",
                "explain": "An open question an agent settles by argument, prior art or a run.",
            },
            "BrianQuestion": {
                "label": "Brian's call",
                "color": "#e8892b",
                "explain": "An open question only Brian can decide; it carries a recommendation and a default.",
            },
            "Decision": {
                "label": "Decision it blocks",
                "color": "#4a525c",
                "explain": "The decision or next step that waits on the question.",
            },
            "Concept": {
                "label": "Domain concept",
                "color": "#9aa3ad",
                "explain": "A concept from docs/planning/domain.graph.json that the question bears on.",
            },
        },
        "layout": {"direction": "RIGHT", "algorithm": "layered"},
        "nodes": [],
        "edges": [],
    }
    seen: set[str] = set()
    open_count = 0
    for q in ledger["questions"]:
        if q["status"] != "open":
            continue
        open_count += 1
        kind = "BrianQuestion" if q["owner"] == "brian" else "AgentQuestion"
        explain = q["question"]
        if q["owner"] == "brian":
            explain += f" Recommendation: {q['recommendation']} Default: {q['default']}"
        else:
            explain += f" Settled by: {q['resolves_with']}"
        graph["nodes"].append(
            {"id": q["id"], "label": f"{q['id']}: {q['short']}", "kind": kind, "explain": explain}
        )
        dec_id = f"{q['id']}-blocks"
        graph["nodes"].append(
            {"id": dec_id, "label": _short(q["blocks"]), "kind": "Decision", "explain": q["blocks"]}
        )
        graph["edges"].append(
            {"id": f"{q['id']}-to-decision", "source": q["id"], "target": dec_id, "label": "blocks"}
        )
        for cid in q["touches"]:
            if cid not in concepts:
                raise SystemExit(f"{q['id']} touches unknown concept {cid}")
            if cid not in seen:
                seen.add(cid)
                c = concepts[cid]
                graph["nodes"].append(
                    {
                        "id": cid,
                        "label": c["label"],
                        "kind": "Concept",
                        "dashed": bool(c.get("dashed", False)),
                        "explain": c.get("explain", ""),
                    }
                )
            graph["edges"].append(
                {"id": f"{q['id']}-{cid}", "source": q["id"], "target": cid, "label": "bears on"}
            )
    (HERE / "open-questions.graph.json").write_text(json.dumps(graph, indent=1) + "\n")
    print(f"{open_count} open questions, {len(seen)} concepts, {len(graph['edges'])} edges")


if __name__ == "__main__":
    main()
