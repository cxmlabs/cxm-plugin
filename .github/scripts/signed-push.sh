#!/usr/bin/env bash
# Usage: signed-push.sh <branch> <parent-sha> [--force]. GitHub signs a commit made through the Git Data API; needs GH_TOKEN.
set -euo pipefail
branch=$1
parent=$2
force=false
[ "${3:-}" = --force ] && force=true
cd "$(git rev-parse --show-toplevel)"
api="repos/$GITHUB_REPOSITORY/git"

entries=$(git diff --name-status --no-renames -z "$parent" HEAD | while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  if [ "$status" = D ]; then
    mode=$(git ls-tree "$parent" -- "$path" | cut -d' ' -f1)
    jq -n --arg p "$path" --arg m "$mode" '{path:$p, mode:$m, type:"blob", sha:null}'
  else
    mode=$(git ls-tree HEAD -- "$path" | cut -d' ' -f1)
    blob=$(git show "HEAD:$path" | base64 -w0 | jq -Rs '{content:., encoding:"base64"}' | gh api "$api/blobs" --input - -q .sha)
    jq -n --arg p "$path" --arg m "$mode" --arg s "$blob" '{path:$p, mode:$m, type:"blob", sha:$s}'
  fi
done | jq -s .)

tree=$(jq -n --arg b "$(git rev-parse "$parent^{tree}")" --argjson e "$entries" '{base_tree:$b, tree:$e}' | gh api "$api/trees" --input - -q .sha)
[ "$tree" = "$(git rev-parse 'HEAD^{tree}')" ] || { echo "API tree $tree differs from the HEAD tree" >&2; exit 1; }
commit=$(git log -1 --format=%B HEAD | jq -Rs --arg t "$tree" --arg p "$parent" '{message:sub("\\s+$"; ""), tree:$t, parents:[$p]}' | gh api "$api/commits" --input - -q .sha)

if gh api "$api/ref/heads/$branch" --silent 2>/dev/null; then
  gh api -X PATCH "$api/refs/heads/$branch" -f sha="$commit" -F force="$force" --silent
else
  gh api "$api/refs" -f ref="refs/heads/$branch" -f sha="$commit" --silent
fi
echo "$commit"
