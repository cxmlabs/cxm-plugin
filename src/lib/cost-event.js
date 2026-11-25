// The shape of one cost result for telemetry: counts, closed words and buckets. No amount and no text of the input.
import { sanitizeMessage } from './errors.js';
import { openReasons } from './cost-lines.js';
import { redact } from './session-trace.js';

// The closed lists of the keys in the cost-of-change skill. A test holds both sides together.
export const PROVIDERS = ['aws', 'github'];
export const DIMENSIONS = ['write-requests', 'read-requests', 'api-requests', 'data-scanned', 'data-transfer', 'data-processed', 'ingestion', 'storage', 'compute-time', 'asset-time', 'ci-minutes', 'commitment-fee', 'tokens', 'events'];
const SERVICE = /^[a-z0-9_.-]{1,40}$/;
const MAX_ITEMS = 60;
const MAX_FACTORS = 20;
const MAX_DIRECTIVE = 300;

// A fault quotes the input, so only a code of this list leaves. The order matters: the first match wins.
const FAULT_CODES = [
  ['not_an_object', /^it is not (a JSON|an) object/], ['schema_version', /^schema_version is not/], ['not_a_list', /^(lines|coverage) is not a list|^factors is not a list/],
  ['missing_text', /^(organization|id|key|target|item|what|why|source\.ref|shared) is not a text/], ['at', /^at is not/], ['amount_given', /^it holds an amount/],
  ['units', /^the units reduce/], ['unit_shape', /^unit "/], ['currency', /is a currency other than/], ['range_order', /^low is above high/], ['number', /^(low|high) is not a finite/],
  ['divide', /^divide is not|^it divides by/], ['no_source', /^it has no source/], ['rate_source', /^a \$ factor needs a source/], ['grade_source', /needs a source of kind assumption$|needs grade D$/],
  ['grade_range', /^grade D needs a low below/], ['unknown_tag', /^unknown tag/], ['unknown_direction', /^unknown direction/], ['unknown_grade', /^unknown grade/],
  ['unknown_source_kind', /^unknown source kind/], ['unknown_coverage_kind', /^unknown coverage kind/], ['unknown_constant', /^unknown constant/], ['constant_of', /^constant \w+ needs "of"/],
  ['unknown_gap', /^unknown gap/], ['unknown_field', /^unknown field/], ['repeated_id', /^another line has this id/], ['zero', /^its high is 0/], ['not_finite', /is not finite$/],
  ['shared_count', /^\d+ shared texts/], ['shared_values', /^shared "/], ['activity', /activity/], ['no_directive', /states no directive/], ['extra_directive', /takes (no|a) directive$/],
  ['extra_gap', /takes (no|a) gap$/], ['file_not_written', /^CXM_COST_RESULT_FILE cannot be written/],
];
const PREFIX = /^(input|lines|file|line \d+|line "[^"]*"|coverage \d+): (factor \d+: )?(source: )?/;
const faultCode = (fault) => {
  const reason = fault.replace(PREFIX, '');
  return FAULT_CODES.find(([, pattern]) => pattern.test(reason))?.[0] ?? 'other';
};

const sizeBucket = (value) => ['lt_1', '1_10', '10_100', '100_1000', 'gte_1000'][[1, 10, 100, 1000].filter((edge) => Math.abs(value) >= edge).length];
function ratioBucket({ low, high }) {
  if (low < 0 && high > 0) return 'crosses_zero';
  const [smaller, larger] = [Math.abs(low), Math.abs(high)].sort((a, b) => a - b);
  if (larger === smaller) return '1_2';
  return larger > 10 * smaller ? 'gt_10' : larger >= 5 * smaller ? '5_10' : larger >= 2 * smaller ? '2_5' : '1_2';
}
// A text that the masks of an error message would change can hold an id, so it does not leave.
function keyParts(key) {
  const [provider, service, dimension, more] = key.split('/');
  const known = more === undefined && PROVIDERS.includes(provider) && DIMENSIONS.includes(dimension) && SERVICE.test(service) && sanitizeMessage(service) === service;
  return known ? { provider, service, dimension } : { provider: 'other', service: 'other', dimension: 'other' };
}

// `input` is sound when `faults` is empty: each tag, direction, grade, kind and gap is then a word of a closed list.
export function costResultEvent(input, { faults = [], result }, { full = false } = {}) {
  const head = { ok: faults.length === 0, fault_count: faults.length, fault_codes: [...new Set(faults.map(faultCode))].sort() };
  if (faults.length) return head;
  const { headline, open } = result;
  const reasons = openReasons(input);
  const asked = [...input.lines, ...input.coverage].filter((value) => value.directive !== undefined);
  return {
    ...head,
    line_count: input.lines.length,
    estimated_count: headline.estimated_lines.length,
    open_count: open.lines.length,
    directive_count: asked.length,
    uncovered_targets: headline.uncovered_targets,
    coverage: Object.fromEntries(['uncovered_target', 'unmeasured', 'not_billed', 'doubt'].map((kind) => [kind, input.coverage.filter((entry) => entry.kind === kind).length])),
    headline: headline.estimated_lines.length
      ? { grade: headline.grade, low_size: sizeBucket(headline.low), high_size: sizeBucket(headline.high), ratio: ratioBucket(headline) }
      : null,
    lines: input.lines.slice(0, MAX_ITEMS).map((line, i) => ({
      tag: line.tag,
      direction: line.direction,
      ...keyParts(line.key),
      grade: result.lines[i].grade,
      state: open.lines.includes(line.id) ? 'open' : headline.estimated_lines.includes(line.id) ? 'estimated' : 'outside',
      open_reason: reasons.get(line.id) ?? null,
      size: sizeBucket(Math.max(Math.abs(result.lines[i].low), Math.abs(result.lines[i].high))),
      ratio: ratioBucket(result.lines[i]),
      factors: line.factors.slice(0, MAX_FACTORS).map((f) => (f.constant ? 'constant' : `${f.source.kind}:${f.grade}`)),
      activity: line.factors.some((f) => f.activity === true),
      shared: line.factors.some((f) => f.shared !== undefined),
      gap: line.gap ?? null,
    })),
    // Redacted before the cut, so a key that the cut would break is still found.
    ...(full ? { directives: asked.slice(0, MAX_ITEMS).map((value) => redact(value.directive).slice(0, MAX_DIRECTIVE)) } : {}),
  };
}
