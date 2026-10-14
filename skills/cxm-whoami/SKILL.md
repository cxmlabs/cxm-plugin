---
name: cxm-whoami
description: Use when the user wants to check their CloudExMachina connection, verify they are logged in, confirm which organization is active, or test that the CXM plugin works.
---

# Verify CloudExMachina connection

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

When the user wants to confirm the CloudExMachina connection is working:

```bash
cxm whoami
```

A successful response returns the signed-in user's identity and the active organization,
proving the browser login, org selection, and API are all working. Report the active
organization and the user's email.

If it says "Not logged in" or "Session expired", tell the user to run `cxm login`.
