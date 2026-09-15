#!/usr/bin/env bash
# Mirrors apps/eve from the personal agent repo (boringcomputers/ruth).
#
# apps/eve is a verbatim copy of ruth's apps/eve plus deterministic transforms;
# nothing in apps/eve is edited by hand in this repo:
#   1. agent/instructions.md is replaced with a generic placeholder (the
#      builder generates per-agent instructions at deploy time, and the
#      personal instructions shouldn't ship in the product repo).
#   2. .eve-template-release is derived from ruth's commit count, giving
#      deployed agents a monotonic release number to order templates by.
#   3. template-overrides/igi/** is laid back over the mirror, restoring this
#      deployment's own prompt and authored tools (see the block below).
#
# Run from anywhere inside the repo; leaves the mirror staged (git add).
set -euo pipefail

RUTH_REPO="${RUTH_REPO:-https://github.com/boringcomputers/ruth}"
RUTH_REF="${RUTH_REF:-main}"

root="$(git rev-parse --show-toplevel)"
cd "$root"

git fetch --quiet "$RUTH_REPO" "$RUTH_REF"
ruth_sha="$(git rev-parse FETCH_HEAD)"
# Count only commits touching apps/eve: monotonic, and stable when a ruth
# push doesn't change the template (no phantom "update available").
release="$(git rev-list --count FETCH_HEAD -- apps/eve)"

git rm -rq --ignore-unmatch apps/eve
git checkout FETCH_HEAD -- apps/eve

cp apps/builder/template-overrides/instructions.md apps/eve/agent/instructions.md

# IGI overrides. The placeholder copied above is what the product ships; these
# files are this deployment's own identity, its authored web_search (the harness
# only substitutes a native search for openai/anthropic/google/gateway models,
# and this agent runs Vyce), and its Mexico City clock. They live in
# apps/builder, which is never mirrored, and are laid back over the mirror here
# so a sync cannot silently revert production.
#
# Layout mirrors the destination: template-overrides/igi/agent/<path> is copied
# to apps/eve/agent/<path>. An override wins over ruth, so a ruth change to an
# overridden file would be frozen out — hence the drift warning below.
IGI_OVERRIDES="apps/builder/template-overrides/igi"
IGI_BASE="apps/builder/template-overrides/igi/base.sha256"
if [ -d "$IGI_OVERRIDES/agent" ]; then
  find "$IGI_OVERRIDES/agent" -type f -print | while IFS= read -r src; do
    rel="${src#"$IGI_OVERRIDES/agent/"}"
    # instructions.md is the placeholder slot: it is meant to differ.
    if [ "$rel" = "instructions.md" ]; then continue; fi
    recorded="$(awk -v p="agent/$rel" '$2 == p { print $1 }' "$IGI_BASE" 2>/dev/null || true)"
    if [ -z "$recorded" ]; then continue; fi
    upstream="$(git show "FETCH_HEAD:apps/eve/agent/$rel" 2>/dev/null | sha256sum | cut -d' ' -f1 || true)"
    if [ -n "$upstream" ] && [ "$upstream" != "$recorded" ]; then
      echo "WARNING: ruth changed agent/$rel — the IGI override wins, so review it against the new upstream. ruth: $(printf '%s' "$upstream" | cut -c1-12), override base: $(printf '%s' "$recorded" | cut -c1-12)."
    fi
  done
  cp -R "$IGI_OVERRIDES/agent/." apps/eve/agent/
fi

printf '%s\n' "$release" > apps/eve/.eve-template-release

git add -A apps/eve
echo "synced apps/eve to ${ruth_sha} (release ${release})"
