// The Claude Code hooks module, loaded under plain Node so CI holds its switch and its prompt section.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHART_SHAPE } from '../src/lib/viz.js';
import { register } from '../hooks/visuals.js';

const handlers = (options) => {
  const seen = {};
  register((name, ...rest) => (seen[name] = rest.at(-1)), options);
  return seen;
};

test('rich_visuals off registers nothing, on registers the prompt section and the renderer', () => {
  assert.deepEqual(Object.keys(handlers({ rich_visuals: false })), []);
  assert.deepEqual(Object.keys(handlers({})).sort(), ['prompt.compose', 'ui.render']);
});

test('the prompt says visuals are on only where a surface draws', async () => {
  const compose = handlers({})['prompt.compose'];
  const next = async () => ({ sections: [] });
  assert.deepEqual((await compose({}, { surfaces: [] }, next)).sections, []);
  const [section] = (await compose({}, { surfaces: ['terminal'] }, next)).sections;
  assert.equal(section.id, 'cxm-agent-plugin:visuals');
  assert.ok(section.text.includes(CHART_SHAPE), 'an agent without the shared rules still has the chart shape');
});

test('a message with no text renders as Claude Code draws it', () => {
  const render = handlers({})['ui.render'];
  assert.equal(render({}, { props: {} }, () => 'default'), 'default');
});
