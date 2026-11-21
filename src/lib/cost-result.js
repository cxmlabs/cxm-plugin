// Shape check of the structured cost-of-change result. It reads no file, calls no network and compares no amount.
// The schema is skills/cxm-cost-of-change/cost-result.schema.json; keep the two in step.

const STATUSES = ['priced', 'no_billed_unit_change', 'failed'];
const GRADES = ['A', 'B', 'C', 'D'];
const BOUNDS = ['none', 'floor', 'ceiling'];
const RUNS_HERE = ['yes', 'no', 'unknown'];
const UNMEASURED = 'unmeasured';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v !== '';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateCostResult(value) {
  if (!isObject(value)) return ['result: must be an object'];
  const faults = [];
  const need = (ok, path, message) => {
    if (!ok) faults.push(`${path}: ${message}`);
    return ok;
  };
  const grade = (v, path) => need(GRADES.includes(v), path, 'must be A, B, C or D');
  const text = (v, path) => need(isText(v), path, 'must be a text');
  const range = (v, path) => need(isObject(v) && isNumber(v.low) && isNumber(v.high) && isText(v.unit), path, 'must hold a number low, a number high and a text unit');
  const list = (v, path, each) => {
    if (!need(Array.isArray(v), path, 'must be a list')) return false;
    v.forEach((item, i) => each(item, `${path}[${i}]`));
    return true;
  };

  need(value.schema_version === 1, 'schema_version', 'must be 1');
  text(value.organization, 'organization');
  need(STATUSES.includes(value.status), 'status', `must be one of ${STATUSES.join(', ')}`);

  list(value.headlines, 'headlines', (h, path) => {
    text(h?.payer, `${path}.payer`);
    text(h?.currency, `${path}.currency`);
    range(h?.list, `${path}.list`);
    if (h?.effective !== undefined) range(h.effective, `${path}.effective`);
    grade(h?.grade, `${path}.grade`);
    need(BOUNDS.includes(h?.bound), `${path}.bound`, `must be one of ${BOUNDS.join(', ')}`);
  });

  list(value.targets, 'targets', (t, path) => {
    text(t?.target, `${path}.target`);
    need(RUNS_HERE.includes(t?.runs_here?.value), `${path}.runs_here.value`, `must be one of ${RUNS_HERE.join(', ')}`);
    grade(t?.runs_here?.grade, `${path}.runs_here.grade`);
    text(t?.runs_here?.basis, `${path}.runs_here.basis`);
    grade(t?.grade, `${path}.grade`);
    for (const kind of ['list', 'effective']) if (t?.amounts?.[kind] !== UNMEASURED) range(t?.amounts?.[kind], `${path}.amounts.${kind}`);
  });

  const citations = isObject(value.citations) ? value.citations : {};
  need(isObject(value.citations), 'citations', 'must be an object');
  for (const [id, c] of Object.entries(citations)) {
    need(isNumber(c?.value), `citations.${id}.value`, 'must be a number');
    text(c?.unit, `citations.${id}.unit`);
    text(c?.formula, `citations.${id}.formula`);
    text(c?.source, `citations.${id}.source`);
    grade(c?.grade, `citations.${id}.grade`);
  }

  list(value.results, 'results', (r, path) => {
    text(r?.id, `${path}.id`);
    text(r?.target, `${path}.target`);
    text(r?.item, `${path}.item`);
    if (r?.amount !== UNMEASURED) {
      range(r?.amount, `${path}.amount`);
      grade(r?.grade, `${path}.grade`);
    }
    if (!list(r?.factors, `${path}.factors`, (f, fpath) => {
      text(f?.unit, `${fpath}.unit`);
      if (f?.value === UNMEASURED) return text(f.reason, `${fpath}.reason`);
      need(isNumber(f?.value), `${fpath}.value`, `must be a number or ${UNMEASURED}`);
      grade(f?.grade, `${fpath}.grade`);
      need(Object.hasOwn(citations, f?.cite), `${fpath}.cite`, `cite ${f?.cite} is not defined in citations`);
    })) return;
    need(r.factors.length > 0, `${path}.factors`, 'must hold a factor');
  });

  list(value.doubts, 'doubts', (d, path) => {
    text(d?.text, `${path}.text`);
    need(isNumber(d?.effect_low), `${path}.effect_low`, 'must be a number');
    need(isNumber(d?.effect_high) || d?.effect_high === UNMEASURED, `${path}.effect_high`, `must be a number or ${UNMEASURED}`);
    text(d?.resolve, `${path}.resolve`);
  });

  if (value.status === 'failed') {
    text(value.failed?.count, 'failed.count');
    text(value.failed?.unit_of_work, 'failed.unit_of_work');
    const amounts = [value.headlines, value.targets, value.results].some((v) => Array.isArray(v) && v.length > 0);
    need(!amounts, 'status', 'a failed result holds an amount');
  }
  if (value.status === 'no_billed_unit_change') {
    const held = [value.headlines, value.targets].some((v) => Array.isArray(v) && v.length > 0);
    need(!held, 'status', 'a no billed unit change result holds a headline or a target');
  }
  return faults;
}
