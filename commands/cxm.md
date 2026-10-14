---
description: Run a CloudExMachina plugin command (auth, price, savings, commitments, context, analytics)
---

If `$ARGUMENTS` is a question rather than a `cxm` command line, answer it with the matching CXM skill. Otherwise run `cxm $ARGUMENTS` in the shell and report the result to the user. With no arguments, run `cxm` to show usage. For `auth login`, tell the user their browser will open to sign in.

If `cxm` is not on PATH, run `node "${CLAUDE_PLUGIN_ROOT}/bin/cxm.js" $ARGUMENTS` instead.
