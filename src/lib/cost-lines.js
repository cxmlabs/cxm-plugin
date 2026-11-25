// Computes the amounts, totals and grades of a cost-of-change result from its tagged lines. It imports nothing.

const TAGS = ['direct', 'commitment', 'flag-gated', 'added-runtime', 'llm', 'indirect', 'one-off'];
const HEADLINE = ['direct', 'commitment', 'indirect', 'added-runtime'];
const MAX_SHARED = 4;
const DIRECTIONS = ['add', 'remove'];
const GRADES = ['A', 'B', 'C', 'D'];
const KINDS = ['code', 'dataset', 'route', 'tool', 'public', 'assumption'];
const RATE_KINDS = ['dataset', 'route', 'public'];
const COVERAGE = ['uncovered_target', 'unmeasured', 'not_billed', 'doubt'];
const DIRECTIVE = 'Tell a coding agent what to expose, where, and how to check it';
const GAPS = ['no_dataset', 'no_asset_row', 'no_caller_split', 'no_history', 'no_access', 'assumed_ratio', 'future_volume', 'other'];
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
  refuseOthers(line, ['id', 'key', 'target', 'item', 'at', 'tag', 'direction', 'factors', 'amount', 'directive', 'gap'], refuse);
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
  return { line, factors, computed: { id: line.id, ...range, unit, grade: lowest(factors.flatMap((f) => f.grade ?? [])) } };
}

const lowest = (grades) => grades.reduce((a, b) => (a > b ? a : b), '') || null;
const total = (values) => values.reduce((a, b) => a + b, 0);
const sumRange = (ranges) => ({ low: total(ranges.map((r) => r.low)), high: total(ranges.map((r) => r.high)) });
const weight = (line) => Math.max(Math.abs(line.low), Math.abs(line.high));

// A shared text stands for one unknown, so each line gives it the same values.
function checkShared(parts, on) {
  const first = new Map();
  parts.forEach(({ line, factors }) => factors.forEach((f, n) => {
    if (!f.shared) return;
    const same = first.get(f.shared) ?? first.set(f.shared, f).get(f.shared);
    if (['low', 'high', 'unit', 'grade'].some((key) => same[key] !== f[key])) on(`line ${quote(line.id)}`)(`factor ${n + 1}: shared ${quote(f.shared)} needs the same low, high, unit and grade in each line`);
  }));
  if (first.size > MAX_SHARED) on('input')(`${first.size} shared texts. At most ${MAX_SHARED}`);
}
// The least and the greatest sum over the ends of the shared factors.
function netRange(parts) {
  const texts = [...new Set(parts.flatMap(({ factors }) => factors.flatMap((f) => f.shared ?? [])))];
  const corners = texts.reduce((list, text) => list.flatMap((ends) => ['low', 'high'].map((end) => new Map([...ends, [text, end]]))), [new Map()]);
  const sums = corners.map((ends) => sumRange(parts.map(({ factors, line }) => rangeOf(factors, line.direction, ends))));
  return { low: Math.min(...sums.map((r) => r.low)), high: Math.max(...sums.map((r) => r.high)) };
}
// The least spread of an estimate that holds a factor below grade A. A midpoint of 0 keeps its range.
const MIN_SPREAD = 0.1;
function widen({ low, high }) {
  const middle = (low + high) / 2;
  const half = MIN_SPREAD * Math.abs(middle);
  return { low: Math.min(low, middle - half), high: Math.max(high, middle + half) };
}
// The lines that a shared text connects, also through a third line. Any other line is its own group.
function linked(parts) {
  let found = [];
  for (const part of parts) {
    const texts = part.factors.flatMap((f) => f.shared ?? []);
    const [joined, rest] = [true, false].map((want) => found.filter((g) => g.texts.some((t) => texts.includes(t)) === want));
    found = [...rest, { texts: [...joined.flatMap((g) => g.texts), ...texts], parts: [...joined.flatMap((g) => g.parts), part] }];
  }
  return found.map((g) => ({ parts: g.parts, range: netRange(g.parts) }));
}
const reachesOne = (range) => weight(range) >= 1 - 1e-9;
// Ends of opposite signs, or an end of 0, count as an infinite ratio.
function isOpen({ low, high }) {
  const [smaller, larger] = [Math.abs(low), Math.abs(high)].sort((a, b) => a - b);
  return reachesOne({ low, high }) && ((low < 0 && high > 0) || larger > 10 * smaller * (1 + 1e-9));
}
// A line of low confidence tells a coding agent what to expose. A line of more confidence has nothing to ask.
function checkDirectives(parts, open, on) {
  for (const part of parts) {
    const { line, computed } = part;
    const say = on(`line ${quote(line.id)}`);
    const low = open.includes(part) ? 'its group is open' : HEADLINE.includes(line.tag) && computed.grade === 'D' && reachesOne(computed) ? 'its grade is D' : '';
    if (low && !isText(line.directive)) say(`${low}, and it states no directive. ${DIRECTIVE}`);
    if (low) needOne(line.gap, GAPS, 'gap', say);
    if (!low && Object.hasOwn(line, 'directive')) say('it is not open and not a headline line of grade D at $1/mo or more, so it takes no directive');
    if (!low && Object.hasOwn(line, 'gap')) say('it takes no directive, so it takes no gap');
  }
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
// In a table cell. A backslash before a pipe takes a space, because two backslashes free the pipe.
const cell = (s) => code(s).replace(/(\\*)\|/g, (_, slashes) => `${slashes}${slashes && ' '}\\|`);

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
function coverageRows(entries) {
  if (entries.length === 0) return [];
  const reason = (c) => `Why: ${code(c.why)}. Source: ${c.source.kind}, ${code(c.source.ref)}.`;
  return ['', 'Coverage:', '', ...[...groups(entries, (c) => `${c.kind} ${reason(c)}`).values()].map((held) => `- ${held[0][0].kind}: ${held.map(([c]) => code(c.what)).join(', ')}. ${reason(held[0][0])}`)];
}

// The headline lines from the largest, then the unmeasured entries, then the other lines.
function tableOf(input, result, commit) {
  const lines = input.lines.map((line, i) => ({ line, computed: result.lines[i] }));
  const inside = ({ line }) => HEADLINE.includes(line.tag);
  const lineRow = ({ line, computed }) => {
    const at = commit ? line.at.slice(0, -commit.length - 1) : line.at;
    const open = result.open.lines.includes(line.id) ? 'not estimated yet: ' : '';
    return {
      cells: [`${inside({ line }) ? '' : `${line.tag}: `}${[line.item, line.key, line.target, at].map(cell).join(', ')}`, `${open}${span(computed)}${computed.unit === '$' ? ' once' : ''}`, computed.grade, cell(formula(line.factors))],
      directive: line.directive,
      gap: line.gap,
    };
  };
  const rows = [
    ...lines.filter(inside).sort((a, b) => weight(b.computed) - weight(a.computed)).map(lineRow),
    ...input.coverage.filter((c) => c.kind === 'unmeasured').map((c) => ({ cells: [cell(c.what), 'not measured', '-', cell(c.why)], directive: c.directive, gap: c.gap })),
    ...lines.filter((l) => !inside(l)).map(lineRow),
  ];
  if (rows.length === 0) return [];
  const asked = rows.map((row) => (row.directive === undefined ? '-' : cell(row.directive)));
  const first = (text, i) => (text !== '-' && asked.indexOf(text) < i ? `as row ${asked.indexOf(text) + 1}` : text);
  return ['', '| # | What | $/month | Grade | How it is computed | Directive for a coding agent |', '|---|---|---|---|---|---|', ...rows.map((row, i) => `| ${[i + 1, ...row.cells, `${first(asked[i], i)}${row.gap ? `, gap: ${row.gap}` : ''}`].join(' | ')} |`)];
}

function sectionOf(input, result, parts) {
  const { lines, totals, headline, open } = result;
  const uncovered = `Uncovered targets: ${headline.uncovered_targets}.`;
  const out = ['### Cost of this change', ''];
  const counted = headline.estimated_lines.length;
  const asked = counted + open.lines.length;
  const share = `Estimated lines: ${counted} of ${asked} headline lines. `;
  if (counted) out.push(`**${amount(headline)}**, grade ${headline.grade}. ${share}${uncovered}`);
  else if (lines.length || input.coverage.some((c) => c.kind === 'unmeasured')) out.push(`No line can be estimated yet. ${asked ? share : ''}${uncovered}`);
  else out.push(`No billed line moves. ${uncovered}`);
  if (open.lines.length) out.push('', `Not estimated yet: between ${dollars(open.low)} and ${dollars(open.high)} per month, ${open.lines.length} ${open.lines.length === 1 ? 'line' : 'lines'}.`);
  const spread = parts.some(({ computed }) => headline.estimated_lines.includes(computed.id) && computed.grade !== 'A') && Math.abs(headline.low + headline.high) > 1e-9;
  if (spread) out.push('', 'The estimate is at least ±10 % around its midpoint.');
  const held = TAGS.filter((tag) => parts.some(({ line }) => line.tag === tag && !open.lines.includes(line.id)));
  for (const [tag, name] of [['commitment', 'Commitment fee'], ['indirect', 'Indirect cost']]) if (held.includes(tag)) out.push('', `${name} inside the headline: ${amount(totals[tag])}.`);
  const shares = GRADES.filter((g) => headline.shares[g] > 0).map((g) => `${g} ${(headline.shares[g] * 100).toFixed(1)} %`);
  if (shares.length) out.push('', `Share of the weight by grade: ${shares.join(', ')}.`);
  const texts = [...new Set(parts.flatMap(({ line, factors }) => (HEADLINE.includes(line.tag) ? factors.flatMap((f) => f.shared ?? []) : [])))];
  if (texts.length) out.push('', `Each part takes one end of each shared factor, so it can be narrower than the sum of its lines: ${texts.map(code).join(', ')}.`);
  if (held.length) out.push('', 'Totals:', '', ...held.map((tag) => `- ${tag}: ${amount(totals[tag])}`));
  const commits = new Set(input.lines.map((l) => l.at.slice(l.at.lastIndexOf('@') + 1)));
  const commit = commits.size === 1 ? [...commits][0] : '';
  if (commit) out.push('', `Each file is at commit ${code(commit)}.`);
  out.push(...coverageRows(input.coverage.filter((c) => c.kind !== 'unmeasured')), ...tableOf(input, result, commit));
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
      refuseOthers(entry, ['kind', 'what', 'why', 'source', 'directive', 'gap'], refuse);
      needOne(entry.kind, COVERAGE, 'coverage kind', refuse);
      needTexts(entry, ['what', 'why'], refuse);
      if (entry.kind === 'unmeasured' && !isText(entry.directive)) refuse(`an unmeasured entry states no directive. ${DIRECTIVE}`);
      if (entry.kind !== 'unmeasured' && Object.hasOwn(entry, 'directive')) refuse('only an unmeasured entry takes a directive');
      if (entry.kind === 'unmeasured') needOne(entry.gap, GAPS, 'gap', refuse);
      else if (Object.hasOwn(entry, 'gap')) refuse('only an unmeasured entry takes a gap');
      needSource(entry.source, refuse);
    } else refuse('it is not an object');
  }
  if (faults.length === 0) checkShared(parts, on);
  if (faults.length) return { faults };
  const lines = parts.map((part) => part.computed);
  // Each total is at most this sum, so one check covers them all.
  if (!Number.isFinite(total(lines.map(weight)))) return { faults: ['lines: the sum of the amounts is not finite'] };

  const bundles = linked(parts.filter((part) => HEADLINE.includes(part.line.tag)));
  const opened = bundles.filter((g) => isOpen(g.range));
  const closed = bundles.filter((g) => !isOpen(g.range));
  const inOrder = (list) => parts.filter((part) => list.some((g) => g.parts.includes(part)));
  checkDirectives(parts, inOrder(opened), on);
  if (faults.length) return { faults };
  // An open line is in no total: a total never adds an estimate and an unknown.
  const kept = (tag) => parts.filter((part) => part.line.tag === tag && !inOrder(opened).includes(part)).map((part) => part.computed);
  const totals = Object.fromEntries(TAGS.map((tag) => [tag, { ...sumRange(kept(tag)), unit: tag === 'one-off' ? '$' : '$/mo' }]));
  const idsOf = (list) => inOrder(list).map((part) => part.line.id);
  const main = inOrder(closed).map((part) => part.computed);
  const weights = total(main.map(weight));
  const share = (line) => weight(line) / weights;
  const net = sumRange(closed.map((g) => g.range));
  const exact = main.every((line) => line.grade === 'A');
  const result = {
    lines,
    totals,
    headline: {
      ...(exact ? net : widen(net)),
      unit: '$/mo',
      // The margin keeps a float residue from hiding a line that holds exactly 10 percent.
      grade: lowest(main.filter((line) => share(line) >= 0.1 - 1e-9).map((line) => line.grade)),
      shares: Object.fromEntries(GRADES.map((g) => [g, total(main.filter((line) => line.grade === g).map(share))])),
      uncovered_targets: input.coverage.filter((entry) => entry.kind === 'uncovered_target').length,
      estimated_lines: idsOf(closed),
      open_lines: idsOf(opened),
    },
    open: { ...sumRange(opened.map((g) => g.range)), unit: '$/mo', lines: idsOf(opened) },
  };
  return { result, section: sectionOf(input, result, parts) };
}
