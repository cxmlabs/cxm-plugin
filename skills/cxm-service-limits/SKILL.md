---
name: cxm-service-limits
description: Use when the user asks about an AWS service limit, quota, or maximum — "max IOPS on gp3", "how many X can I have", "what's the limit/quota/ceiling for Y", or any capacity ceiling that gates a rightsizing or scaling plan. Limits change over time; verify, never recall.
---

# AWS service limits & quotas — verify, never recall

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

A wrong limit quietly makes a rightsizing or capacity plan infeasible, and a confident wrong number is
worse than saying you're not sure. So this skill has one rule:

**Never state a numeric limit you did not obtain from a lookup in THIS turn.** Not from memory, not from
this skill — look it up, cite where, then answer. If you cannot verify it, say so plainly and point to
where the user can (do not emit a figure you didn't check). This file deliberately contains **no limit
numbers** — a baked-in number is exactly the stale/wrong value that caused the failure this skill exists
to prevent.

## How to ground the number

1. **Adjustable account quotas** (instances per region, rules per SG, EIPs, functions…) — Service Quotas
   holds the live value:
   ```bash
   aws service-quotas list-service-quotas --service-code <svc>            # find the quota + its code
   aws service-quotas get-service-quota      --service-code <svc> --quota-code <code>   # adjusted value
   aws service-quotas get-aws-default-service-quota --service-code <svc> --quota-code <code>  # AWS default
   ```
   Service codes are things like `ec2`, `ebs`, `vpc`, `lambda`, `rds` — `list-services` enumerates them.

2. **Fixed technical maximums** (per-volume IOPS/throughput, ENIs per instance type, max volume size) —
   these are usually **not** in Service Quotas. Ground them from the **current AWS documentation** for that
   service (a docs/web lookup you can cite), not recall. Quote the value **and** the constraint that gates
   it (a size/ratio minimum, a baseline above which extra capacity is billed, a higher tier if they need
   more). If you have no way to fetch the doc this turn, say the limit is unverified and name the exact AWS
   page to check — never fill the gap with a remembered number.

## Answering

Lead with the number, then only the one caveat that matters (ratio, minimum size, cost above the free
baseline, or a higher-capacity alternative). Always name the source you actually checked. If a limit
blocks the plan the user is pursuing, say so directly. On "Not logged in" / "Session expired", run
`cxm login`.
