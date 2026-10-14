---
name: cxm-cloud-topology
description: Use when the user asks about their cloud footprint, account structure, which clouds/accounts/regions they use, multi-cloud posture, or where their spend is concentrated across accounts. Describes the connected CloudExMachina organization's cloud topology.
---

# Cloud topology (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

When the user asks about their cloud footprint / accounts / regions / posture, run these
authenticated queries and summarize.

1. Overall posture:
   ```bash
   cxm analytics query '{"measures":["cloud_topology_posture.cloud_count","cloud_topology_posture.total_account_count","cloud_topology_posture.total_monthly_cost_usd"],"dimensions":["cloud_topology_posture.posture","cloud_topology_posture.dominant_cloud"]}'
   ```
2. Per cloud provider:
   ```bash
   cxm analytics query '{"measures":["cloud_topology_per_cloud.account_count","cloud_topology_per_cloud.ou_count","cloud_topology_per_cloud.active_region_count","cloud_topology_per_cloud.monthly_cost_usd","cloud_topology_per_cloud.cost_share_pct"],"dimensions":["cloud_topology_per_cloud.cloud_provider_id","cloud_topology_per_cloud.top_regions_str"]}'
   ```
3. Top accounts by spend:
   ```bash
   cxm analytics query '{"measures":["cloud_topology_accounts.monthly_cost_usd"],"dimensions":["cloud_topology_accounts.cloud_provider_id","cloud_topology_accounts.account_name","cloud_topology_accounts.primary_regions_str"],"order":{"cloud_topology_accounts.monthly_cost_usd":"desc"},"limit":10}'
   ```

Present: posture (single/multi-cloud, dominant cloud), account and region counts, monthly cost,
then the top accounts. Attribute to **CloudExMachina**. If a query says "Not logged in" /
"Session expired", tell the user to run `cxm login`.
