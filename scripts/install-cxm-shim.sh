#!/usr/bin/env sh
# Writes `cxm` into ~/.local/bin as a launcher that runs the newest installed plugin copy; never fails a session start.

mark='# cxm-agent-plugin launcher'
# Ours: the launcher, or the symlink to a plugin cxm.js that earlier versions installed, broken or not;
# a link into node_modules is a global npm install.
ours() {
  if [ -L "$1" ]; then
    case "$(readlink "$1")" in */node_modules/*) return 1 ;; */bin/cxm.js) return 0 ;; esac
    return 1
  fi
  [ -f "$1" ] && grep -qF "$mark" "$1"
}

# Config folders sessions used, one absolute path per line and appended once, so a plain shell finds them too.
roots="$HOME/.local/state/cxm-agent-plugin/roots"
for root in "$CLAUDE_CONFIG_DIR" "$CODEX_HOME"; do
  case "$root" in /*) ;; *) continue ;; esac
  case "$root" in *'
'*) continue ;; esac
  mkdir -p "$(dirname "$roots")" 2>/dev/null || continue
  grep -qxF "$root" "$roots" 2>/dev/null || { printf '%s\n' "$root" >> "$roots"; } 2>/dev/null
done

launcher() {
  cat <<'EOF'
#!/bin/sh
# cxm-agent-plugin launcher: runs the newest installed copy of the plugin, of Claude Code or Codex.
# Session folders and saved folders the user owns, by absolute path; a cache folder named by a commit is no release.
target=$({ printf '%s\n' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CODEX_HOME:-$HOME/.codex}"; [ -f "$HOME/.local/state/cxm-agent-plugin/roots" ] && while IFS= read -r saved; do [ -O "$saved" ] && printf '%s\n' "$saved"; done < "$HOME/.local/state/cxm-agent-plugin/roots"; } | while IFS= read -r root; do
  case "$root" in (/*) ;; (*) continue ;; esac
  for f in "$root"/plugins/cache/cxm-marketplace/cxm-agent-plugin/*/bin/cxm.js; do [ -f "$f" ] && printf '%s\n' "$f"; done
done | awk -F/ '$(NF-2) ~ /^[0-9]+\.[0-9]+\.[0-9]+/ { split($(NF-2), v, "."); printf "%09d%09d%09d %s\n", v[1], v[2], v[3], $0 }' | sort | tail -n 1 | cut -d' ' -f2-)
[ -n "$target" ] || { echo "cxm: no CloudExMachina plugin is installed. Run: npx @cloudexmachina/cxm@latest install" >&2; exit 127; }
exec node "$target" "$@"
EOF
}

# The first bin folder where cxm is absent or ours gets the launcher; a foreign cxm is never replaced.
written=''
for dir in "$HOME/.local/bin" "$HOME/bin"; do
  path="$dir/cxm"
  if [ -e "$path" ] || [ -L "$path" ]; then ours "$path" || continue; fi
  mkdir -p "$dir" 2>/dev/null || continue
  # A file per run, renamed into place: two session starts at once never share a half-written file.
  tmp="$path.$$.tmp"
  if { launcher > "$tmp"; } 2>/dev/null && chmod +x "$tmp" 2>/dev/null && mv -f "$tmp" "$path" 2>/dev/null; then
    written="$path"
    break
  fi
  rm -f "$tmp" 2>/dev/null
done

[ -n "$written" ] || exit 0
found="$(command -v cxm 2>/dev/null || true)"
# Only this launcher, reached by any path, is no shadow; an old launcher or symlink of ours runs an old copy.
if [ "$found" != "$written" ] && ! cmp -s "$found" "$written"; then
  if [ -n "$found" ]; then
    if ours "$found"; then remove="rm \"$found\", or npm uninstall -g @cloudexmachina/cxm for an npm install"; else remove="npm uninstall -g @cloudexmachina/cxm for an npm install"; fi
    echo "CloudExMachina: the cxm on PATH ($found) is not this plugin's launcher and may be outdated. Call $written directly, and tell the user to remove the other one ($remove)."
  else
    echo "CloudExMachina: the cxm command is at $written, but $(dirname "$written") is not on PATH. Call $written directly, and tell the user to add export PATH=\"$(dirname "$written"):\$PATH\" to their shell profile."
  fi
fi
exit 0
