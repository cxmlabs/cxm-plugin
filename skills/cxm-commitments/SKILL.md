---
name: cxm-commitments
description: Use when the user asks whether to buy, or how much to buy, of Savings Plans or Reserved Instances — "should we buy more commitment", "how much SP should I add", "size an RI purchase", "what commitment should we lock in". Sizes a layered buy list from the commitment ladder and the Reservation fleet, net of what the estate already holds.
---

# Commitment planning — size a Savings Plan or Reservation buy (CloudExMachina)

**Read `../cxm-shared-rules.md` first** (the path is relative to this skill's base directory).
It holds how to query CXM and how to answer, for every CXM skill. Follow it in every answer.

You size a Savings Plan or Reservation buy for the estate. You return a layered buy list. Do the
investigation and judgment below.

## Step 1 — Settle the segment

A commitment question is under-specified in one way that matters: the segment. Term and payment
option are not a scope question. They enter only through the measured discount rate. So the same
ladder answers all of them.

- Default to Compute and say you did. Compute has the broadest eligibility.
- Name the other segments where the org has eligible usage. Offer them.
- Never sum across segments.

## Step 2 — Read the ladder and existing holdings

For a Savings Plan, read the commitment ladder for the segment:

```bash
cxm analytics query '{"measures":["commitment_ladder.mct_hourly_usd","commitment_ladder.redline_hourly_usd","commitment_ladder.covered_ode_hourly_usd","commitment_ladder.discount_rate","commitment_ladder.basis_usable","commitment_ladder.hour_coverage_pct","commitment_ladder.on_demand_hours_count"],"dimensions":["commitment_ladder.segment"]}'
```

Defer to the completeness gate. Quote a level only when its basis is complete (`basis_usable` = 1,
then `hour_coverage_pct` = 100 and `on_demand_hours_count` > 0). Below that, the floor is an upper
bound, not the true minimum. Say so, and do not size against it.

For a database or other Reservation buy, read the fleet sizing. It returns one row per commitment
group, with all sizing precomputed:

```bash
cxm analytics query '{"measures":["ri_reservation_sizing_view.current_od_monthly_usd","ri_reservation_sizing_view.gross_savings_monthly_usd","ri_reservation_sizing_view.gross_savings_annual_usd"],"dimensions":["ri_reservation_sizing_view.buy_quantity_floor","ri_reservation_sizing_view.buy_quantity_breakeven","ri_reservation_sizing_view.seasonal_trough_ratio","ri_reservation_sizing_view.single_month_divergence_ratio","ri_reservation_sizing_view.commitment_group_id","ri_reservation_sizing_view.service","ri_reservation_sizing_view.buy_instance_type","ri_reservation_sizing_view.region","ri_reservation_sizing_view.engine","ri_reservation_sizing_view.lease_contract_length","ri_reservation_sizing_view.purchase_option"]}'
```

Size at the demand floor. Never reserve idle or dark-DR capacity. The related signals and the
coverage trend show the prerequisites and whether Commitment coverage grows or decays:

```bash
cxm analytics query '{"measures":["ri_opt_signals_view.resource_count","ri_opt_signals_view.monthly_cost_usd"],"dimensions":["ri_opt_signals_view.commitment_group_id","ri_opt_signals_view.check_name"]}'
cxm analytics query '{"measures":["ri_coverage_trend_view.node_od_equivalent_total","ri_coverage_trend_view.commitment_covered_paid","ri_coverage_trend_view.on_demand_paid"],"dimensions":["ri_coverage_trend_view.commitment_group_id"],"timeDimensions":[{"dimension":"ri_coverage_trend_view.billing_month","granularity":"month","dateRange":"last 6 months"}]}'
```

When a signal flags idle, oversized, or migratable Assets, name it in the summary as cleanup to
sequence before the buy — delete idle capacity, do not reserve it — and quote the signal's resource
count. A non-reservable SKU (for example Aurora Serverless ACU usage) does not change the buy for the
reservable groups: still reserve the durable reservable core, and separately note that the
non-reservable spend is capped by autoscaling, not a reservation.

Always read the existing holdings and cross-check before you recommend a buy:

```bash
cxm analytics query '{"measures":["commitment_details_table.hourly_commitment","commitment_details_table.count","commitment_details_table.mtd_savings"],"dimensions":["commitment_details_table.commitment_type","commitment_details_table.segment","commitment_details_table.commitment_group_id","commitment_details_table.lease_contract_term","commitment_details_table.upfront","commitment_details_table.status","commitment_details_table.end_date"]}'
```

The buy is the recommended amount minus what the estate already holds. Compute the durable residual
explicitly and state the arithmetic: `residual = mct_hourly_usd − covered_ode_hourly_usd`. When that
residual is positive there is still floor to lock: you must size and recommend the buy on the
residual. A positive residual is always a buy, however small it looks next to the holdings.

A large existing holding is not saturation. Deep existing Commitment coverage — many active plans,
high lifetime or MTD savings, Commitment coverage near the floor — is not a reason to recommend
nothing; it lowers the residual, it does not zero it. Recommend nothing only when the residual itself
is zero or negative, never because the estate already holds a lot. State the residual, not the total.

## Step 3 — Size the buy

- Size to the durable floor. Never commit above the break-even redline. The band above the redline
  is negative expected value. There, reshape the workload; do not buy. Say in the summary that
  committing above the durable floor loses money and stays on demand.
- Recommend nothing only when `mct_hourly_usd` is zero — no always-on floor at all. Attribute this
  to the zero floor, not to missing data and not to existing Commitment coverage. Name the lever
  (scheduling, Spot). A non-zero floor with a positive residual always yields a buy line.
- Layer a Savings Plan in two rungs off the uncovered residual, not the gross ladder: a 3yr
  All-Upfront rung on the durable residual (`mct_hourly_usd − covered_ode_hourly_usd`, floored at
  0), and a 1yr No-Upfront rung on 80% of the uncovered surge (`0.8 × (redline_hourly_usd −
  mct_hourly_usd)`, less any surge already covered). The 3yr rung fronts cash for the durable core;
  the 1yr rung stays cash-light on the surge. Drop a rung whose residual is 0. For a Reservation buy,
  preserve each group's supplied term and purchase option.
- A Reservation buy line copies `commitment_group_id` verbatim from its fleet-sizing row. Its
  quantity is that row's `buy_quantity_floor` (or `buy_quantity_breakeven`): instances of
  `buy_instance_type`. Never use `reserve_quantity_*` as a quantity — it counts normalized units.
  Drop a group whose buy quantity is 0. Copy the row's `current_od_monthly_usd` onto its line.
- Drop a Reserved group whose gross savings are below $50/mo: the purchase effort outweighs the
  saving. Drop a group whose low `seasonal_trough_ratio` or high `single_month_divergence_ratio`
  marks a seasonal or draining fleet: a reservation strands on a shrinking pool. Name each dropped
  group and its reason in the rationale.
- When the related signals return a migration, rightsizing or generation smell for a group, the
  fleet shape changes first. Leave that group out of the Reservation buy list and name the smell to
  finish before the buy. Idle or serverless signals do not gate the buy.
- Price the rungs with the platform's figures, never by multiplying an ODE level by a discount rate
  yourself. Read the measured rate per term and payment option for the segment:
  ```bash
  cxm analytics query '{"measures":["commitment_rate_ladder.rate_1yr_no_upfront","commitment_rate_ladder.rate_3yr_all_upfront","commitment_rate_ladder.priced_share_1yr_no_upfront","commitment_rate_ladder.priced_share_3yr_all_upfront"],"dimensions":["commitment_rate_ladder.segment"]}'
  ```
  The Savings Plan simulator returns the `commitment` $/hr and `annual_savings` for a coverage
  fraction. It prices 1yr All-Upfront only and ignores other terms:
  ```bash
  cxm api GET '/commitments/simulate-sp?sp_type=Compute&coverage=0.7'
  ```
  (`sp_type` ∈ Compute, EC2Instance, Database, SageMaker.) Copy `commitment` and `annual_savings`
  straight from the response. No per-term break-even pricing is exposed yet. When a rung has no
  reported price for its term, give the residual ODE $/hr and the measured rate, and state the gap.
- Choose the instrument by fleet behaviour. Use a Compute Savings Plan for a fleet that churns
  across instance families and generations. Use a Standard Reserved Instance only for a stable
  shape (databases). State which instrument you chose and the fleet behaviour that rules out the
  alternative.

## Step 4 — EDP / PRA caution (buy side)

- When EDP/PRA data is unavailable, size the buy on the fleet floor and report only the contract
  facts that the estate provides.
- Check the commitment risk level before you recommend a buy:
  ```bash
  cxm analytics query '{"dimensions":["billing_commitment_risk.commitment_risk_level","billing_commitment_risk.has_active_pra","billing_commitment_risk.spend_declining_trend"],"timeDimensions":[{"dimension":"billing_commitment_risk.billing_month","granularity":"month","dateRange":"last 3 months"}]}'
  ```
- Never push committed spend below the EDP floor. The customer may owe AWS the shortfall, or lose
  the discount at renewal.
- Savings are gross (list price). Net of EDP/PRA, they are lower. Verify the headroom before you
  commit.
- Never state an EDP or PRA rate from memory. Each customer negotiates the discount per contract.

## Answer shape

1. Summary: the buy in one line, the segment you sized, and the cleanup to sequence first.
2. Buy list, one line per rung or group: instrument, term and payment option, $/hr commitment (or
   quantity × `buy_instance_type` and `commitment_group_id`), annual gross saving.
3. Rationale: the residual arithmetic, each dropped group and its reason, each data gap, and each
   cross-check that stays open.

## Guardrails

- Read-only: never call write endpoints.
- Copy the platform's figures; do not recompute them. Net them against holdings, but never restate
  a savings, rate, or floor the queries did not report. All savings are gross (pre-EDP).
- Frame the output as loss avoided, in console dollars. Every dollar must trace to a line in the
  buy list.
- Do not use internal metric names (MCT, redline, ESR, MCR, ICR) in the summary or rationale.
- State data gaps explicitly. Never drop missing data silently.
