// Computes the amounts, totals and grades of a cost-of-change result from its tagged lines. It imports nothing.

const TAGS = ['direct', 'commitment', 'flag-gated', 'added-runtime', 'llm', 'indirect', 'one-off'];
const HEADLINE = ['direct', 'commitment', 'indirect'];
const MAX_SHARED = 4;
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
  const { low, high, unit, grade, source, divide = false, activity = false, shared } = factor;
  refuseOthers(factor, ['low', 'high', 'unit', 'grade', 'source', 'divide', 'activity', 'shared'], say);
  if (!isCount(low)) say('low is not a finite number of 0 or more');
  if (!isCount(high)) say('high is not a finite number of 0 or more');
  if (isCount(low) && isCount(high) && low > high) say('low is above high');
  if (typeof divide !== 'boolean') say('divide is not true or false');
  if (divide === true && low === 0) say('it divides by a low of 0');
  if (typeof activity !== 'boolean') say('activity is not true or false');
  if (Object.hasOwn(factor, 'shared') && !isText(shared)) say('shared is not a text');
  needOne(grade, GRADES, 'grade', say);
  if (grade === 'D' && low === high) say('grade D needs a low below its high');
  needSource(source, say);
  const atoms = readUnit(unit, say);
  if (activity === true && atoms?.some(([atom]) => atom === '$')) say('a $ factor takes no activity');
  if (KINDS.includes(source?.kind)) {
    const assumed = source.kind === 'assumption';
    if (atoms?.some(([atom]) => atom === '$') && !RATE_KINDS.includes(source.kind)) say('a $ factor needs a source of kind dataset, route or public');
    else if (grade === 'D' && !assumed) say('grade D needs a source of kind assumption');
    else if (GRADES.includes(grade) && grade !== 'D' && assumed) say('a source of kind assumption needs grade D');
  }
  return { ...band(factor), unit, grade, divide, atoms, ...(isText(shared) ? { shared: clean(shared) } : {}) };
}
// A count that follows people or traffic moves between half of its low and twice its high.
const band = ({ low, high, activity }) => (activity === true ? { low: low / 2, high: high * 2 } : { low, high });

// The range of a line. `ends` holds the end of each shared factor that is fixed.
function rangeOf(factors, direction, ends = new Map()) {
  let low = 1;
  let high = 1;
  for (const f of factors) {
    const end = ends.get(f.shared);
    const [from, to] = end ? [f[end], f[end]] : [f.low, f.high];
    low = f.divide ? low / to : low * from;
    high = f.divide ? high / from : high * to;
  }
  // `0 - x` and `x + 0` never give -0, which JSON does not keep.
  return direction === 'remove' ? { low: 0 - high, high: 0 - low } : { low: low + 0, high };
}

// Returns the computed line and its factors, or nothing when it has a fault.
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

  if (line.factors.filter((f) => f.activity === true).length > 1) return refuse('more than one activity factor');
  const range = rangeOf(factors, line.direction);
  if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) return refuse('the amount is not finite');
  if (weight(range) === 0) return refuse('its high is 0. Put it in coverage');
  return { factors, computed: { id: line.id, ...range, unit, grade: lowest(factors.flatMap((f) => f.grade ?? [])) } };
}

const lowest = (grades) => grades.reduce((a, b) => (a > b ? a : b), '') || null;
const total = (values) => values.reduce((a, b) => a + b, 0);
const sumRange = (ranges) => ({ low: total(ranges.map((r) => r.low)), high: total(ranges.map((r) => r.high)) });
const weight = (line) => Math.max(Math.abs(line.low), Math.abs(line.high));

// A shared text stands for one unknown, so each line gives it the same values.
function checkShared(lines, parts, on) {
  const first = new Map();
  parts.forEach(({ factors }, i) => factors.forEach((f, n) => {
    if (!f.shared) return;
    const same = first.get(f.shared) ?? first.set(f.shared, f).get(f.shared);
    if (['low', 'high', 'unit', 'grade'].some((key) => same[key] !== f[key])) on(`line ${quote(lines[i].id)}`)(`factor ${n + 1}: shared ${quote(f.shared)} needs the same low, high, unit and grade in each line`);
  }));
  if (first.size > MAX_SHARED) on('input')(`${first.size} shared texts. At most ${MAX_SHARED}`);
}
// The least and the greatest sum over the ends of the shared factors.
function headlineRange(lines, parts) {
  const texts = [...new Set(parts.flatMap(({ factors }) => factors.flatMap((f) => f.shared ?? [])))];
  const corners = texts.reduce((list, text) => list.flatMap((ends) => ['low', 'high'].map((end) => new Map([...ends, [text, end]]))), [new Map()]);
  const sums = corners.map((ends) => sumRange(parts.map(({ factors }, i) => rangeOf(factors, lines[i].direction, ends))));
  return { low: Math.min(...sums.map((r) => r.low)), high: Math.max(...sums.map((r) => r.high)) };
}
// `weights` sets the size of a float residue, which counts as 0 and as equal.
function statusOf({ low, high }, weights) {
  const [from, to] = [low, high].map((v) => (Math.abs(v) <= weights * 1e-9 ? 0 : v));
  const [smaller, larger] = [Math.abs(from), Math.abs(to)].sort((a, b) => a - b);
  if (larger < 1 - 1e-9) return 'estimate';
  const wide = from < 0 && to > 0 ? smaller >= 1 - 1e-9 : larger > 10 * smaller * (1 + 1e-9);
  return wide ? 'cannot_estimate' : 'estimate';
}

// Cents from $1. Below it, three digits down to a millionth of a dollar, so a float residue prints as zero.
function dollars(v) {
  const a = Math.abs(v);
  const text = a >= 1 ? a.toFixed(2) : String(Number(Number(a.toPrecision(3)).toFixed(6)));
  const [int, dec = ''] = text.split('.');
  return `${v < 0 && Number(text) !== 0 ? '-' : ''}$${int.replace(/\B(?=(\d{3})+$)/g, ',')}.${dec.padEnd(2, '0')}`;
}
function span({ low, high }) {
  const [from, to] = [dollars(low), dollars(high)];
  return from === to ? from : `${from} to ${to}`;
}
const amount = (range) => `${span(range)} ${range.unit === '$' ? 'once' : 'per month'}`;
// A one-line code span that its text cannot close, so a field renders as text only.
const code = (s) => `\`${clean(s).replace(/`/g, "'")}\``;

// Each group holds the values of one printed prefix, in input order.
function groups(values, prefix) {
  const found = new Map();
  values.forEach((value, i) => found.set(prefix(value), [...(found.get(prefix(value)) ?? []), [value, i]]));
  return found;
}
// The factors as the input gives them, with no ref.
function formula(factors) {
  const value = ({ low, high }) => (low === high ? `${low}` : `${low}–${high}`);
  const text = (f) => (f.constant ? `${f.constant}${f.of ? ` of ${f.of}` : ''}` : `${value(f)}${f.unit === '1' ? '' : ` ${f.unit}`} [${[f.grade, f.source.kind, ...(f.activity ? [`activity: ${value(band(f))}`] : []), ...(f.shared ? [`shared: ${f.shared}`] : [])].join(', ')}]`);
  return factors.map((f, i) => `${f.divide ? `${i ? '' : '1 '}÷ ` : i ? '× ' : ''}${text(f)}`).join(' ');
}
function lineRows(lines, computed, shared) {
  const prefix = (l) => `- ${l.tag}, ${l.direction}: ${code(l.item)}, ${code(l.key)}, at ${code(shared ? l.at.slice(0, -shared.length - 1) : l.at)}`;
  const own = ([l, i], indent) => `${code(l.id)} ${code(l.target)}: ${span(computed[i])}, grade ${computed[i].grade}\n${indent}= ${code(formula(l.factors))}`;
  return [...groups(lines, prefix)].map(([text, held]) => (held.length === 1 ? `${text}. ${own(held[0], '  ')}` : [text, ...held.map((h) => `  - ${own(h, '    ')}`)].join('\n')));
}
function coverageRows(entries) {
  const reason = (c) => `Why: ${code(c.why)}. Source: ${c.source.kind}, ${code(c.source.ref)}.`;
  return [...groups(entries, (c) => `${c.kind} ${reason(c)}`).values()].map((held) => `- ${held[0][0].kind}: ${held.map(([c]) => code(c.what)).join(', ')}. ${reason(held[0][0])}`);
}

// The two headline lines with the largest width.
function widest(lines, computed) {
  const width = new Map(lines.map((l, i) => [l, computed[i].high - computed[i].low]));
  return lines.filter((l) => HEADLINE.includes(l.tag)).sort((a, b) => width.get(b) - width.get(a)).slice(0, 2);
}

function sectionOf(input, result) {
  const { lines, totals, headline } = result;
  const uncovered = `Uncovered targets: ${headline.uncovered_targets}.`;
  const out = ['### Cost of this change', ''];
  if (lines.length === 0) out.push(`No billed line moves. ${uncovered}`);
  else {
    const held = TAGS.filter((tag) => input.lines.some((l) => l.tag === tag));
    const shares = GRADES.filter((g) => headline.shares[g] > 0).map((g) => `${g} ${(headline.shares[g] * 100).toFixed(1)} %`);
    const cannot = headline.status === 'cannot_estimate';
    const said = cannot ? `Cannot estimate: between ${dollars(headline.low)} and ${dollars(headline.high)} per month` : amount(headline);
    out.push(`**${said}**, grade ${headline.grade ?? 'none'}. ${uncovered}`, '');
    if (cannot) out.push(`The widest lines: ${widest(input.lines, lines).map((l) => `${code(l.id)} (${code(l.item)})`).join(', ')}.`, '');
    if (held.includes('commitment')) out.push(`Commitment fee inside the headline: ${amount(totals.commitment)}.`, '');
    if (held.includes('indirect')) out.push(`Indirect cost inside the headline: ${amount(totals.indirect)}.`, '');
    const texts = [...new Set(input.lines.flatMap((l) => l.factors.flatMap((f) => (f.shared ? clean(f.shared) : []))))];
    if (texts.length) out.push(`The headline takes one end of each shared factor, so it can be narrower than the sum of the totals: ${texts.map(code).join(', ')}.`, '');
    if (shares.length) out.push(`Share of the weight by grade: ${shares.join(', ')}.`, '');
    out.push('Totals:', '', ...held.map((tag) => `- ${tag}: ${amount(totals[tag])}`), '');
    const commits = new Set(input.lines.map((l) => l.at.slice(l.at.lastIndexOf('@') + 1)));
    const shared = commits.size === 1 ? [...commits][0] : '';
    out.push(`Lines,${shared && ` at commit ${code(shared)},`} in dollars per month (a one-off line: in dollars, once):`, '', ...lineRows(input.lines, lines, shared));
  }
  if (input.coverage.length) out.push('', 'Coverage:', '', ...coverageRows(input.coverage));
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
  const parts = [...input.lines].map((line, i) => {
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
  if (faults.length === 0) checkShared(input.lines, parts, on);
  if (faults.length) return { faults };
  const lines = parts.map((part) => part.computed);
  // Each total is at most this sum, so one check covers them all.
  if (!Number.isFinite(total(lines.map(weight)))) return { faults: ['lines: the sum of the amounts is not finite'] };

  const tagged = (tags, values = lines) => values.filter((_, i) => tags.includes(input.lines[i].tag));
  const totals = Object.fromEntries(TAGS.map((tag) => [tag, { ...sumRange(tagged([tag])), unit: tag === 'one-off' ? '$' : '$/mo' }]));
  const main = tagged(HEADLINE);
  const weights = total(main.map(weight));
  const share = (line) => weight(line) / weights;
  const range = headlineRange(tagged(HEADLINE, input.lines), tagged(HEADLINE, parts));
  const result = {
    lines,
    totals,
    headline: {
      ...range,
      unit: '$/mo',
      status: statusOf(range, weights),
      // The margin keeps a float residue from hiding a line that holds exactly 10 percent.
      grade: lowest(main.filter((line) => share(line) >= 0.1 - 1e-9).map((line) => line.grade)),
      shares: Object.fromEntries(GRADES.map((g) => [g, total(main.filter((line) => line.grade === g).map(share))])),
      uncovered_targets: input.coverage.filter((entry) => entry.kind === 'uncovered_target').length,
    },
  };
  return { result, section: sectionOf(input, result) };
}
