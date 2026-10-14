// Build an AcxmOpportunityCreate payload for POST /acxm/opportunities.
// Required by the API: arns (>=1), hri_name, analysis. Everything else optional.

export function buildOpportunityPayload(spec) {
  if (!spec.arns?.length) throw new Error('report-opportunity requires at least one --arn');
  if (!spec.title) throw new Error('report-opportunity requires --title');
  if (!spec.analysis) throw new Error('report-opportunity requires --analysis');
  const payload = {
    arns: spec.arns,
    hri_name: spec.title,
    analysis: spec.analysis,
    cost_currency_code: 'USD',
  };
  const optional = {
    description: spec.description,
    resource_type: spec.resourceType,
    effort_level: spec.effort,
    account_id: spec.accountId,
    region: spec.region,
  };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== undefined) payload[k] = v;
  }
  if (spec.savingsMonthly !== undefined) {
    // A saving is money off the bill, so it needs the bill it comes off. A visibility or allocation
    // finding (tagging, chargeback) has no saving: report it without --savings-monthly.
    const current = spec.currentMonthly;
    if (!(Number.isFinite(current) && current > 0)) throw new Error('--savings-monthly needs --current-monthly: the monthly cost of these resources today');
    if (!(spec.savingsMonthly > 0 && spec.savingsMonthly <= current)) {
      throw new Error(`--savings-monthly must be above 0 and at most --current-monthly (${current})`);
    }
    payload.cost_current_monthly = current;
    payload.cost_savings_monthly = spec.savingsMonthly;
  }
  return payload;
}
