#!/usr/bin/env bash
# Fail when hooks/ or types/ changed but the plugin version did not.
# Claude Code installs a plugin into a folder named after its version and reuses that folder, so an
# unchanged version means the merged change never runs (code2-workspace #349, #985).
# Compares the working tree with the base ref (default origin/main).
set -u
base=${1:-origin/main}
cd "$(git rev-parse --show-toplevel)" || exit 2
fork=$(git merge-base HEAD "$base") || { echo "version-bump check: cannot find $base" >&2; exit 2; }
changed=$(git diff --name-only "$fork" -- hooks types ':(exclude)hooks/*.test.ts') || exit 2
untracked=$(git ls-files --others --exclude-standard -- hooks types ':(exclude)hooks/*.test.ts') || exit 2
changed=$(printf '%s\n%s\n' "$changed" "$untracked" | sed '/^$/d')
[ -z "$changed" ] && { echo "version-bump check: no shipped code changed"; exit 0; }
version() { sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p'; }
ours=$(version < .claude-plugin/plugin.json)
theirs=$(git show "$base:.claude-plugin/plugin.json" | version)
[ -n "$ours" ] && [ -n "$theirs" ] || { echo "version-bump check: cannot read the version" >&2; exit 2; }
if [ "$ours" = "$theirs" ]; then
  echo "version-bump check FAILED: these changed but .claude-plugin/plugin.json is still $ours:" >&2
  echo "$changed" >&2
  echo "Bump the version and add a CHANGELOG.md entry, or installed copies keep the old code." >&2
  exit 1
fi
echo "version-bump check: $theirs -> $ours"
