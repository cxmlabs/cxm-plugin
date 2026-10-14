---
name: cxm-repo-graph
description: Use when working IN a code or infrastructure repo and you want to connect what you're reading or editing to the live cloud — a Terraform resource's real ARN, its cost, its owner, its opportunities, and what depends on it — including links into OTHER repos you don't have checked out. Backed by CloudExMachina's repo graph.
---

# Repo graph — link local code to the live estate (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

CXM crawls **all** of the organization's repos and builds a graph tying code → build → infrastructure →
live AWS resources, with git ownership and cross-repo dependency edges. It's queryable via `cxm analytics query`, so
the file open in front of you stops being just text: it becomes a live, costed, owned, connected object —
and the graph knows repos you don't have checked out.

**Use the local files as the anchor, then enrich.** Read the Terraform/code as you normally would — that's
the ground truth for *what the change is*. Then reach the graph for what the local repo can't tell you: the
resource's live identity, spend, owner, and blast radius across the whole estate.

## The one join that unlocks it: `terraform_address` → ARN

`resource_map` maps, per crawled repo, a Terraform resource **address** (the
`aws_ecs_cluster.main` you see in the `.tf`) to the **live ARN** it currently is, plus account, region,
resource type, and the declaring file. So from a resource in front of you:

1. Look it up: filter `resource_map` on `repo` (the git remote `owner/repo`) and
   `terraform_address` → get its **ARN**, account, region.
2. Chain the ARN outward (this is where the value is):
   - **Cost** → `costs` filtered `resource_id = <ARN>` — what this exact resource costs, and its trend.
   - **Waste** → the opportunities for that ARN — is there a rightsizing/idle/commitment finding on *this* resource.
   - **Owner / provenance** → `repo_graph_owners` and the node's git authorship — who created and maintains it.
   - **Blast radius** → `repo_graph_nodes` (`in_degree`/`out_degree`/`centrality`) and `repo_graph_edges`
     (`references` / `deploys` / `uses_module`) — what depends on it before you touch it.

The exact field names live in the cube — `cxm analytics schema resource_map` (and the
other `repo_graph_*` cubes) lists them in one call; don't guess. Note the mapped `source_file` is a
**basename**, so join on the **address**, not a path.

## Cross-repo — the part the local checkout can never give you

The graph spans every repo CXM crawled, and its edges cross repo boundaries. The thing you're editing in
one repo is often defined, deployed, or consumed in **another** repo you don't have open: a service or
Dockerfile here is deployed by a Terraform resource *there*; a shared module (`terraform-aws-*`) is reused
across many repos. Node ids carry their `owner/repo:` prefix, so a node/edge tells you which repo it lives
in. Lead with that when it matters: "the cluster this runs on is declared in `<other-repo>/<file>`, costs
$X/mo, owned by Y" — knowledge no local-only agent has.

Attribute graph facts to **CloudExMachina**. On "Session expired", run `cxm login`.
