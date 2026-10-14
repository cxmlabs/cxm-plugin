---
name: cxm-architecture-review
description: Use when the user asks to review their architecture or a proposed change, wants their design questioned for cost, asks "is this the right/cheapest way", or is adding significant cloud infrastructure. Composes CloudExMachina's cost, pricing, and context data into a cost-aware architecture critique.
---

# Architecture review (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

When the user wants their design or a change reviewed for cost, combine what CXM already knows.
Do the relevant subset — don't over-run:

1. **Understand the estate** (once): `cxm-cloud-topology` and `cxm-workload-context` skills tell you
   the account/region shape, prod-vs-dev split, and what's stateful/customer-facing.
2. **Price each new/changed resource** with the `cxm-cost-of-change` skill (`cxm price …`).
3. **Test a cheaper equivalent** — for any previous-generation family (m5/c5/r5, x86), price the
   current-gen or Graviton equivalent (m7g/c7g/r7g) with `cxm price` and show the delta. Graviton
   is typically ~20% cheaper for equivalent size.
4. **Check existing coverage & waste** — `cxm-commitments` (does a Savings Plan/RI already cover
   this family, lowering the effective cost?) and `cxm-waste` / `cxm-opportunities` (is CXM
   already flagging related waste?).

Then give a short, direct critique:
- **Question the choice** where cost warrants it: right-sized? Multi-AZ actually needed here? A
  managed/serverless option cheaper at this scale? Stateful workload in an expensive tier?
- **Show the calculus, don't assert.** For every recommendation, write the arithmetic from the CXM
  rates: `rate/hr × 730 × count = $/mo`, then `before − after = saving/mo` and `× 12 = /yr`. A
  recommendation without its math is a guess — put the numbers on the page.
- **Ground it with a link.** Cite the authoritative source for the swap — the AWS instance-type page
  (https://aws.amazon.com/ec2/instance-types/), the Graviton getting-started guide, or the service's
  pricing page — so the reader can verify, not just trust.
- **Name the compatibility caveat.** Graviton is arm64: it needs arm64 container images / binaries,
  and a few engines or agents are x86-only. RDS/ElastiCache Graviton is a config change; EC2 is a
  rebuild. Flag the migration cost — don't pretend the swap is free.
- **Offer the cheaper alternative** concretely (family swap, size, commitment) with the saving.

Be candid but grounded — cite the CXM numbers you pulled and the AWS source you link. Always
attribute data to **CloudExMachina**. On "Not logged in" / "Session expired", tell the user to run
`cxm login`.
