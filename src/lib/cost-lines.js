// Computes the amounts, totals and grades of a cost-of-change result from its tagged lines. It imports nothing.

const TAGS = ['direct', 'commitment', 'flag-gated', 'added-runtime', 'llm', 'indirect', 'one-off'];
const HEADLINE = ['direct', 'commitment'];
const DIRECTIONS = ['add', 'remove'];
const GRADES = ['A', 'B', 'C', 'D'];
const KINDS = ['code', 'dataset', 'route', 'tool', 'public', 'assumption'];
const RATE_KINDS = ['dataset', 'route', 'public'];
const COVERAGE = ['uncovered_target', 'unmeasured', 'not_billed', 'doubt'];
// `@` is the atom that `of` names.
const CONSTANTS = new Map([
  ['h_per_min', { value: 1 / 60, unit: 'h/min' }],
  ['h_per_mo', { value: 730.5, unit: 'h/mo' }],
  ['day_per_mo', { value: 30.4375, unit: 'day/mo' }],
  ['week_per_mo', { value: 365.25 / 84, unit: 'week/mo' }],
  ['million', { value: 1e-6, unit: 'M@/@' }],
  ['thousand', { value: 1e-3, unit: 'k@/@' }],
]);
const ATOM = /^(\$|[\p{L}\p{Sc}%_][\p{L}\p{N}\p{Sc}%_.-]*)$/u;
const CURRENCY = /\p{Sc}|^[Mk]?(usd|eur|gbp|jpy|cny|inr|cad|aud|nzd|chf|sek|nok|dkk|brl|mxn|krw|sgd|hkd|twd|zar|ils|pln|dollars?|euros?)$/iu;
const AT = /^.+:\d+@[0-9a-f]{7,64}$/;
// Control, invisible and line-break characters: one of them can start a new line or send a command to a terminal.
const UNSAFE = /[\p{C}\p{Zl}\p{Zp}]/gu;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clean = (s) => s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
const isText = (v) => typeof v === 'string' && clean(v) !== '';
const isCount = (v) => Number.isFinite(v) && v >= 0;
const quote = (v) => {
  const text = typeof v === 'string' ? clean(v).replace(/"/g, "'") : typeof v;
  return `"${text.length > 80 ? `${text.slice(0, 80)}…` : text}"`;
};

function needTexts(value, keys, say) {
  for (const key of keys) if (!isText(value[key])) say(`${key} is not a text`);
}
function needOne(value, list, name, say) {
  if (!list.includes(value)) say(`unknown ${name} ${quote(value)}. Known: ${list.join(', ')}`);
}
// A misspelled field, such as a wrong `divide`, changes the amount, so an unknown field is refused.
function refuseOthers(value, keys, say) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) say(`unknown field ${quote(key)}`);
}
function needSource(source, say) {
  if (!isObject(source)) return say('it has no source');
  refuseOthers(source, ['kind', 'ref'], (reason) => say(`source: ${reason}`));
  needOne(source.kind, KINDS, 'source kind', say);
  if (!isText(source.ref)) say('source.ref is not a text');
}

// The atoms of a unit, as [atom, 1] above the slash and [atom, -1] below it.
function parseUnit(unit) {
  const [top, bottom, more] = unit.split('/');
  const side = (text, power) => text.split('*').map((atom) => [atom, power]);
  const atoms = [...(top === '1' ? [] : side(top, 1)), ...(bottom === undefined ? [] : side(bottom, -1))];
  return more === undefined && atoms.every(([atom]) => ATOM.test(atom)) ? atoms : null;
}
function readUnit(unit, say) {
  const atoms = typeof unit === 'string' ? parseUnit(unit) : null;
  if (!atoms) return say(`unit ${quote(unit)} is not <atom>*<atom>/<atom>*<atom>, with 1 for an empty numerator`);
  const other = atoms.find(([atom]) => atom !== '$' && CURRENCY.test(atom));
  return other ? say(`${quote(other[0])} is a currency other than $`) : atoms;
}
function addAtoms(powers, atoms, sign) {
  for (const [atom, power] of atoms) powers.set(atom, (powers.get(atom) ?? 0) + sign * power);
}
function unitText(powers) {
  const side = (sign) => [...powers].flatMap(([atom, n]) => Array(Math.max(0, sign * n)).fill(atom)).join('*');
  return (side(1) || '1') + (side(-1) && `/${side(-1)}`);
}

// The parts of one factor. `atoms` is absent when its unit cannot be read.
function readFactor(factor, say) {
  if (!isObject(factor)) return say('it is not an object') ?? {};
  if (Object.hasOwn(factor, 'constant')) {
    const known = CONSTANTS.get(factor.constant);
    if (!known) return say(`unknown constant ${quote(factor.constant)}. Known: ${[...CONSTANTS.keys()].join(', ')}`) ?? {};
    const takesOf = known.unit.includes('@');
    refuseOthers(factor, takesOf ? ['constant', 'of'] : ['constant'], say);
    if (takesOf && !(typeof factor.of === 'string' && ATOM.test(factor.of))) return say(`constant ${factor.constant} needs "of", one atom`) ?? {};
    return { low: known.value, high: known.value, atoms: readUnit(known.unit.replaceAll('@', () => factor.of), say) };
  }
  const { low, high, unit, grade, source, divide = false } = factor;
  refuseOthers(factor, ['low', 'high', 'unit', 'grade', 'source', 'divide'], say);
  if (!isCount(low)) say('low is not a finite number of 0 or more');
  if (!isCount(high)) say('high is not a finite number of 0 or more');
  if (isCount(low) && isCount(high) && low > high) say('low is above high');
  if (typeof divide !== 'boolean') say('divide is not true or false');
  if (divide === true && low === 0) say('it divides by a low of 0');
  needOne(grade, GRADES, 'grade', say);
  if (grade === 'D' && low === high) say('grade D needs a low below its high');
  needSource(source, say);
  const atoms = readUnit(unit, say);
  if (KINDS.includes(source?.kind)) {
    const assumed = source.kind === 'assumption';
    if (atoms?.some(([atom]) => atom === '$') && !RATE_KINDS.includes(source.kind)) say('a $ factor needs a source of kind dataset, route or public');
    else if (grade === 'D' && !assumed) say('grade D needs a source of kind assumption');
    else if (GRADES.includes(grade) && grade !== 'D' && assumed) say('a source of kind assumption needs grade D');
  }
  return { low, high, grade, divide, atoms };
}

// Returns the computed line, or nothing when it has a fault.
function computeLine(line, say) {
  let sound = true;
  const refuse = (reason) => {
    sound = false;
    say(reason);
  };
  needTexts(line, ['id', 'key', 'target', 'item'], refuse);
  if (!(isText(line.at) && AT.test(line.at))) refuse('at is not file:line@sha');
  needOne(line.tag, TAGS, 'tag', refuse);
  needOne(line.direction, DIRECTIONS, 'direction', refuse);
  if (Object.hasOwn(line, 'amount')) refuse('it holds an amount. Delete it: the amount is the product of the factors');
  refuseOthers(line, ['id', 'key', 'target', 'item', 'at', 'tag', 'direction', 'factors', 'amount'], refuse);
  if (!Array.isArray(line.factors) || line.factors.length === 0) return refuse('factors is not a list with a factor');

  const factors = [...line.factors].map((f, i) => readFactor(f, (reason) => refuse(`factor ${i + 1}: ${reason}`)));
  const unit = line.tag === 'one-off' ? '$' : '$/mo';
  if (TAGS.includes(line.tag) && factors.every((f) => f.atoms)) {
    const powers = new Map();
    for (const f of factors) addAtoms(powers, f.atoms, f.divide === true ? -1 : 1);
    const reduced = unitText(powers);
    addAtoms(powers, parseUnit(unit), -1);
    if ([...powers.values()].some((n) => n !== 0)) refuse(`the units reduce to ${reduced}, not ${unit}. Atoms left: ${unitText(powers)}`);
  }
  if (!sound) return undefined;

  let low = 1;
  let high = 1;
  for (const f of factors) {
    low = f.divide ? low / f.high : low * f.low;
    high = f.divide ? high / f.low : high * f.high;
  }
  if (!Number.isFinite(high)) return refuse('the amount is not finite');
  if (high === 0) return refuse('its high is 0. Put it in coverage');
  // `0 - x` and `x + 0` never give -0, which JSON does not keep.
  const range = line.direction === 'remove' ? { low: 0 - high, high: 0 - low } : { low: low + 0, high };
  return { id: line.id, ...range, unit, grade: lowest(factors.flatMap((f) => f.grade ?? [])) };
}

const lowest = (grades) => grades.reduce((a, b) => (a > b ? a : b), '') || null;
const total = (values) => values.reduce((a, b) => a + b, 0);
const sumRange = (ranges) => ({ low: total(ranges.map((r) => r.low)), high: total(ranges.map((r) => r.high)) });
const weight = (line) => Math.max(Math.abs(line.low), Math.abs(line.high));

// Cents from $1. Below it, three digits down to a millionth of a dollar, so a float residue prints as zero.
function dollars(v) {
  const a = Math.abs(v);
  const text = a >= 1 ? a.toFixed(2) : String(Number(Number(a.toPrecision(3)).toFixed(6)));
  const [int, dec = ''] = text.split('.');
  return `${v < 0 && Number(text) !== 0 ? '-' : ''}$${int.replace(/\B(?=(\d{3})+$)/g, ',')}.${dec.padEnd(2, '0')}`;
}
function amount({ low, high, unit }) {
  const [from, to] = [dollars(low), dollars(high)];
  return `${from === to ? from : `${from} to ${to}`} ${unit === '$' ? 'once' : 'per month'}`;
}
// A one-line code span that its text cannot close, so a field renders as text only.
const code = (s) => `\`${clean(s).replace(/`/g, "'")}\``;

function sectionOf(input, result) {
  const { lines, totals, headline } = result;
  const uncovered = `Uncovered targets: ${headline.uncovered_targets}.`;
  const out = ['### Cost of this change', ''];
  if (lines.length === 0) out.push(`No billed line moves. ${uncovered}`);
  else {
    const held = TAGS.filter((tag) => input.lines.some((l) => l.tag === tag));
    const shares = GRADES.filter((g) => headline.shares[g] > 0).map((g) => `${g} ${(headline.shares[g] * 100).toFixed(1)} %`);
    out.push(`**${amount(headline)}**, grade ${headline.grade ?? 'none'}. ${uncovered}`, '');
    if (held.includes('commitment')) out.push(`Commitment fee inside the headline: ${amount(totals.commitment)}.`, '');
    if (shares.length) out.push(`Share of the weight by grade: ${shares.join(', ')}.`, '');
    out.push('Totals:', '', ...held.map((tag) => `- ${tag}: ${amount(totals[tag])}`), '', 'Lines:', '');
    out.push(...input.lines.map((l, i) => `- ${code(l.id)} ${l.tag}, ${l.direction}: ${amount(lines[i])}, grade ${lines[i].grade}. ${code(l.target)}, ${code(l.item)}, ${code(l.key)}, at ${code(l.at)}`));
  }
  if (input.coverage.length) out.push('', 'Coverage:', '', ...input.coverage.map((c) => `- ${c.kind}: ${code(c.what)}. Why: ${code(c.why)}. Source: ${c.source.kind}, ${code(c.source.ref)}.`));
  return `${out.join('\n')}\n`;
}

export function computeCostResult(input) {
  if (!isObject(input)) return { faults: ['input: it is not a JSON object'] };
  const faults = [];
  const on = (name) => (reason) => void faults.push(`${name}: ${reason}`);
  const say = on('input');
  // A printed block holds its old result. It is computed again and never read.
  refuseOthers(input, ['schema_version', 'organization', 'lines', 'coverage', 'result'], say);
  if (input.schema_version !== 2) say('schema_version is not 2');
  needTexts(input, ['organization'], say);
  for (const key of ['lines', 'coverage']) if (!Array.isArray(input[key])) say(`${key} is not a list`);
  if (faults.length) return { faults };

  const ids = new Set();
  const lines = [...input.lines].map((line, i) => {
    const named = isText(line?.id);
    const refuse = on(named ? `line ${quote(line.id)}` : `line ${i + 1}`);
    if (!isObject(line)) return refuse('it is not an object');
    if (named && ids.has(clean(line.id))) refuse('another line has this id');
    if (named) ids.add(clean(line.id));
    return computeLine(line, refuse);
  });
  for (const [i, entry] of input.coverage.entries()) {
    const refuse = on(`coverage ${i + 1}`);
    if (isObject(entry)) {
      refuseOthers(entry, ['kind', 'what', 'why', 'source'], refuse);
      needOne(entry.kind, COVERAGE, 'coverage kind', refuse);
      needTexts(entry, ['what', 'why'], refuse);
      needSource(entry.source, refuse);
    } else refuse('it is not an object');
  }
  if (faults.length) return { faults };
  // Each total is at most this sum, so one check covers them all.
  if (!Number.isFinite(total(lines.map(weight)))) return { faults: ['lines: the sum of the amounts is not finite'] };

  const tagged = (tags) => lines.filter((_, i) => tags.includes(input.lines[i].tag));
  const totals = Object.fromEntries(TAGS.map((tag) => [tag, { ...sumRange(tagged([tag])), unit: tag === 'one-off' ? '$' : '$/mo' }]));
  const main = tagged(HEADLINE);
  const weights = total(main.map(weight));
  const share = (line) => weight(line) / weights;
  const result = {
    lines,
    totals,
    headline: {
      ...sumRange(HEADLINE.map((tag) => totals[tag])),
      unit: '$/mo',
      // The margin keeps a float residue from hiding a line that holds exactly 10 percent.
      grade: lowest(main.filter((line) => share(line) >= 0.1 - 1e-9).map((line) => line.grade)),
      shares: Object.fromEntries(GRADES.map((g) => [g, total(main.filter((line) => line.grade === g).map(share))])),
      uncovered_targets: input.coverage.filter((entry) => entry.kind === 'uncovered_target').length,
    },
  };
  return { result, section: sectionOf(input, result) };
}

// The input with its result. An escaped backtick or control in a text field cannot close the fence.
export function costResultBlock(input, result) {
  const escape = (c) => c.split('').map((u) => `\\u${u.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const json = JSON.stringify({ ...input, result }).replace(/`/g, escape).replace(UNSAFE, escape);
  return `\`\`\`cxm-cost-result\n${json}\n\`\`\``;
}
