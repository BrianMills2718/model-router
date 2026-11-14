#!/usr/bin/env bash
# Reruns the checks the planning package cites and writes docs/planning/checks.txt.
# Run from the repository root. Each section prints its command and its exit status.
S=${CP_SCRIPTS:-$HOME/code2/company-planning/plugins/company-planning/skills/planning-compliance/scripts}
out=docs/planning/checks.txt
: > "$out"
run() { echo "## $1" >> "$out"; echo "\$ $2" >> "$out"; bash -c "$2" >> "$out" 2>&1; echo "exit status: $?" >> "$out"; echo >> "$out"; }
run "plugin validate" "claude plugin validate ."
run "plugin tests (make check runs validate then these)" "claude plugin test ."
run "router report and weekly review tests (code2-workspace)" "cd $HOME/code2/workspace && python3 -m pytest tests/test_router_report.py tests/test_router_review.py -q"
run "wiki rule" "python3 $HOME/code2/agentic-engineering-system-canonical/scripts/md_file_cap.py --repo . --ref HEAD"
run "semantic spectrum (project and planning layers)" "python3 $S/spectrum_check.py --repo . docs/planning/planning-package.json"
run "typed-graph schema over the three graphs" "python3 - <<'PY'
import json,sys
from pathlib import Path
import jsonschema
schema=json.loads((Path.home()/'code2/representation-router/schemas/typed-graph.schema.json').read_text())
bad=0
for p in ['domain.graph.json','open-questions.graph.json']:
    g=json.loads(Path('docs/planning/'+p).read_text())
    errs=list(jsonschema.Draft202012Validator(schema).iter_errors(g))
    print(p,'errors',len(errs)); bad+=len(errs)
print('graphs_invalid',bad); sys.exit(1 if bad else 0)
PY"
