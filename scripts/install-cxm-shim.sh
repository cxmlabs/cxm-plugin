#!/usr/bin/env sh
# Put `cxm` on PATH for marketplace installs, where nothing was npm-installed globally.
# Skills call the bare `cxm` binary, so it has to be reachable. Relinks its own stale shim, never
# replaces a foreign `cxm`, and tells the agent when one shadows it. Never fails a session start.
set -e

root="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}}"
target="$root/bin/cxm.js"
[ -x "$target" ] || exit 0

# An existing cxm that is not this plugin's copy (an older plugin version, an npm install) would shadow it.
existing="$(command -v cxm 2>/dev/null || true)"
if [ -n "$existing" ]; then
  [ "$(readlink "$existing" 2>/dev/null)" = "$target" ] && exit 0
  case "$existing" in
    "$HOME/.local/bin/cxm" | "$HOME/bin/cxm") ;; # our own shim, pointing at an older version: relink below
    *) echo "CloudExMachina: the cxm on PATH ($existing) is not this plugin's copy and may be outdated. Run node \"$target\" instead, and tell the user to remove the old one (npm uninstall -g @cloudexmachina/cxm)."; exit 0 ;;
  esac
fi

for dir in "$HOME/.local/bin" "$HOME/bin"; do
  mkdir -p "$dir" 2>/dev/null || continue
  ln -sf "$target" "$dir/cxm" 2>/dev/null || continue
  case ":$PATH:" in
    *":$dir:"*) exit 0 ;;
    *) echo "CloudExMachina: the cxm command is at $dir/cxm, but $dir is not on PATH. Call $dir/cxm directly, and tell the user to add export PATH=\"$dir:\$PATH\" to their shell profile." ; exit 0 ;;
  esac
done
exit 0
