#!/usr/bin/env sh
# Put `cxm` on PATH for marketplace installs, where nothing was npm-installed globally.
# Skills call the bare `cxm` binary, so it has to be reachable. The command is a launcher that runs the
# newest plugin copy of Claude Code or Codex at each run, so an update or a removed copy never leaves it
# stale. Replaces its own shim, never a foreign `cxm`, and tells the agent when one shadows it.
# Never fails a session start.
set -e

mark='# cxm-agent-plugin launcher'

# Ours: the launcher, or the symlink to a plugin cxm.js that earlier versions installed.
ours() {
  if [ -L "$1" ]; then
    case "$(readlink "$1")" in */bin/cxm.js) return 0 ;; esac
    return 1
  fi
  [ -f "$1" ] && grep -qF "$mark" "$1"
}

launcher() {
  cat <<'EOF'
#!/bin/sh
# cxm-agent-plugin launcher: runs the newest installed copy of the plugin, of Claude Code or Codex.
target=$(for f in "$HOME"/.claude/plugins/cache/*/cxm-agent-plugin/*/bin/cxm.js "$HOME"/.codex/plugins/cache/*/cxm-agent-plugin/*/bin/cxm.js; do
  [ -f "$f" ] && printf '%s\n' "$f"
done | awk -F/ '{ split($(NF-2), v, "."); printf "%09d%09d%09d %s\n", v[1], v[2], v[3], $0 }' | sort | tail -n 1 | cut -d' ' -f2-)
[ -n "$target" ] || { echo "cxm: no CloudExMachina plugin is installed. Run: npx @cloudexmachina/cxm@latest install" >&2; exit 127; }
exec node "$target" "$@"
EOF
}

existing="$(command -v cxm 2>/dev/null || true)"
if [ -n "$existing" ] && ! ours "$existing"; then
  echo "CloudExMachina: the cxm on PATH ($existing) is not this plugin's launcher and may be outdated. Tell the user to remove it (npm uninstall -g @cloudexmachina/cxm)."
  exit 0
fi

for dir in "$HOME/.local/bin" "$HOME/bin"; do
  mkdir -p "$dir" 2>/dev/null || continue
  path="$dir/cxm"
  if [ -e "$path" ] || [ -L "$path" ]; then ours "$path" || continue; fi
  # Written next to it, then renamed, so a cxm that runs meanwhile never reads half a file.
  launcher > "$path.tmp" 2>/dev/null || continue
  chmod +x "$path.tmp"
  mv -f "$path.tmp" "$path"
  case ":$PATH:" in
    *":$dir:"*) exit 0 ;;
    *) echo "CloudExMachina: the cxm command is at $dir/cxm, but $dir is not on PATH. Call $dir/cxm directly, and tell the user to add export PATH=\"$dir:\$PATH\" to their shell profile." ; exit 0 ;;
  esac
done
exit 0
