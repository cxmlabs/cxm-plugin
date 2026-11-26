#!/usr/bin/env sh
# Points the agent to cxm-commitments once per session, when a tool call carries reservation code or data.
export LC_ALL=C
payload="$(grep -Ei 'reserved[-_ ]?[a-z_-]{0,20}(instance|node)|normali[sz]ed[-_ ]?units?|normali[sz]ation[-_ ]?(size[-_ ]?)?factor' 2>/dev/null)" || exit 0
# The common fields come before the tool's own data, which can carry the same names.
common="${payload%%\"tool_input\":*}"
field() { case "$common" in *"\"$1\":\""*) rest="${common#*"\"$1\":\""}"; printf '%s' "${rest%%\"*}" ;; esac; }
session="$(field session_id)"
# The session goes into a path: anything but a plain word means silence.
case "$session" in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac
# A subagent does not use the line, and the agent that decides must still get it.
[ -z "$(field agent_id)" ] || exit 0
# mkdir is atomic: one call per session speaks.
mkdir "${TMPDIR:-/tmp}/cxm-commitments-$session" 2>/dev/null || exit 0
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"CloudExMachina: this code or data handles reserved capacity. Before you change how offers are compared, sized or ordered, open the cxm-commitments skill and follow \"Check the offers and the quantity\". It needs no login."}}'
