---
name: cxm-hunt
description: Use when the user wants to actively hunt for NEW cost-saving opportunities on their cloud that CloudExMachina hasn't already flagged — "find me savings", "dig for waste", "what am I overspending on that isn't in CXM yet". Runs a guided waste hunt using the user's own cloud access plus CXM data.
---

# Hunt for net-new savings (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

The user has direct access to their cloud (aws CLI, metrics, repos). Combine that with CXM's data
to find waste the automated detectors missed, then offer to track it.

1. **Start from CXM's picture** so you don't repeat known findings:
   - Top spend by service — `cxm-cost-drivers`.
   - Already-known waste/opportunities — `cxm-waste`, `cxm-opportunities` (skip anything already listed).
   - Footprint — `cxm-cloud-topology`, `cxm-workload-context`.
2. **Pick the fattest, least-explained spend** and investigate it with the user's OWN tools:
   - `aws` CLI to inspect the actual resources (idle instances, unattached EBS/EIP, old snapshots,
     over-provisioned RDS, empty load balancers, gp2-vs-gp3, prev-gen families, oversized nodegroups).
   - CloudWatch metrics for utilization (CPU/mem/IOPS/network) to prove idle/oversized.
   - Their repos to see if a resource is even referenced anymore.
3. **Price the waste and the fix** with `cxm price` (current cost vs the cheaper target) so every
   finding has a $/mo number.
4. For each solid finding, propose it to the user, then offer to **save it into CXM** with the
   `cxm-report-opportunity` skill and/or open a ticket with `cxm-create-ticket`.

Be rigorous: only surface a finding you can back with a metric or config fact + a priced saving.
Don't guess environments from names. Attribute CXM-sourced data to **CloudExMachina**.
