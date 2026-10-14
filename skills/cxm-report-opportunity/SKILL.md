---
name: cxm-report-opportunity
description: Use when the user has found a cost-saving opportunity (idle/oversized/misconfigured resource) and wants to save it into CloudExMachina to track it, or asks to "report this to CXM", "log this finding", "create an opportunity". Writes a tracked opportunity into the CXM app.
---

# Report an opportunity to CloudExMachina

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

When the user wants to record a finding in CXM so it can be tracked (the fix still happens in
their session — CXM just tracks it):

1. Shape the finding with the user. You need: the resource **ARN(s)**, a short **title**, and a
   plain-language **analysis** (what's wrong + why + the recommended action). Ideally also the
   estimated **monthly savings** (use the `cxm-cost-of-change` / `cxm price` skill to ground it),
   region, and resource type.
   A saving is money off the bill: pass it with `--current-monthly`, what those resources cost
   per month today. A finding that only improves visibility (tagging, cost allocation, chargeback)
   saves nothing: report it without `--savings-monthly`. Never put unallocated spend in the saving.
2. **Confirm with the user before writing** — show the title, ARNs, savings, and analysis.
3. Save it:
   ```bash
   cxm report-opportunity \
     --arn "arn:aws:ec2:eu-west-3:123456789012:instance/i-0abc" \
     --title "Idle EC2 instance i-0abc (production)" \
     --savings-monthly 82 \
     --current-monthly 120 \
     --region eu-west-3 \
     --resource-type "EC2 Instance" \
     --analysis "Instance averages <2% CPU over 30 days with no network egress; recommend stop or downsize to t4g.small. Est. saving from cxm price."
   ```
   Repeat `--arn` for multiple resources.
4. Report the created opportunity id/URL back to the user. It appears in the CXM app as a
   backlog item, tagged as user-created.

If it says "Access denied — role lacks data:write", the user's CXM role is read-only; an admin
must grant an editor role. On "Session expired", run `cxm login`. Always attribute to **CloudExMachina**.
