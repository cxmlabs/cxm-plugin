// Runs with `claude plugin test .`; `node --test` does not pick up .tsx files.
import { expect, test } from 'claude-code/testing'

const PLUGIN = 'cxm-agent-plugin'
const CHART = '{"type":"bar","x":"service","y":"cost","yFormat":"currency","table":true,"data":[{"service":"RDS","cost":1854},{"service":"ECS","cost":1573}]}'
const props = (text: string) => ({ text, isFirstOfReply: true })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a chart block draws in place with its table, and a reply with no block is left alone`, async ($, on) => {
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine: {e.props.text}</Text>
    })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AssistantMessage', props: props('Top spend:\n```chart\n' + CHART + '\n```\nDone.') })
    expect(await ui.find({ type: 'Text', text: /\$1,854/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /█/ }))?.props.color).toBe('#5B8DEF')
    expect(await ui.find({ type: 'Text', text: /Total +\$3,427/ })).toBeDefined()
    await ui.unmount()

    const plain = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AssistantMessage', props: props('No chart here.') })
    expect(await plain.find({ type: 'Text', text: /^engine: No chart here\.$/ })).toBeDefined()
    await plain.unmount()
  })
}

test('a block that does not parse shows as written, with a note', async ($) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props('```chart\n{not json\n```') })
  expect(await ui.find({ type: 'Markdown', text: /\{not json[\s\S]*Not drawn/ })).toBeDefined()
})

test('a queried chart gets its rows from cxm viz --rows once, and a failed query shows the block with its reason', async ($, on) => {
  const runs: (readonly string[])[] = []
  on('process.run', ($, e) => {
    runs.push(e.argv)
    const ok = !e.init?.stdin?.includes('broken')
    return { value: { exitCode: ok ? 0 : 1, stdout: ok ? CHART : '', stderr: ok ? '' : 'cxm: run cxm login\n', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const query = (measure: string) => '```cube-chart\n{"type":"bar","x":"service","y":"cost","query":{"measures":["' + measure + '"]}}\n```'
  const copied: string[] = []
  on('ui.copy', ($, e) => (copied.push(e.text), { value: { isCopied: true } }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props(query('costs.total')) })
  expect(await ui.find({ type: 'Text', text: /\$1,854/ })).toBeDefined()
  await ui.press({ key: (await ui.find({ type: 'Button', text: 'Copy CSV' }))!.key! })
  expect(copied).toEqual(['service,cost\nRDS,1854\nECS,1573'])
  expect(runs.map((argv) => argv.slice(2))).toEqual([['viz', 'cube-chart', '-', '--rows']])
  const failed = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props(query('broken')) })
  expect(await failed.find({ type: 'Markdown', text: /Not drawn: cxm: run cxm login/ })).toBeDefined()
  await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props(query('broken')) })
  expect(runs.length).toBe(2)
})

test('the system prompt tells the agent the visuals are on where a surface draws, and not where none does', async ($, on) => {
  const facts = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', tools: [], outputStyle: null, traits: [], sections: [] }
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }] }))
  const drawn = await $.prompt.compose({ ...facts, surfaces: ['terminal'] })
  expect(drawn.sections.map((s) => s.id)).toEqual(['intro', 'cxm-agent-plugin:visuals'])
  const headless = await $.prompt.compose({ ...facts, surfaces: [] })
  expect(headless.sections.map((s) => s.id)).toEqual(['intro'])
})

test('with rich_visuals off, a chart block shows as written and the agent is not told visuals are on', { options: { rich_visuals: false } }, async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {e.props.text}</Text>
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }] }))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props('```chart\n' + CHART + '\n```') })
  expect(await ui.find({ type: 'Text', text: /^engine: ```chart/ })).toBeDefined()
  const facts = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', tools: [], outputStyle: null, traits: [], sections: [], surfaces: ['terminal'] as const }
  expect((await $.prompt.compose(facts)).sections.map((s) => s.id)).toEqual(['intro'])
})

test('a drawn block has export buttons: Copy CSV copies its rows, Save CSV and Save SVG write files, and each button then says what it did', async ($, on) => {
  const copied: string[] = []
  const written: [string, string][] = []
  on('ui.copy', ($, e) => (copied.push(e.text), { value: { isCopied: true } }))
  on('fs.write', ($, e) => (written.push([e.path, e.text]), { value: undefined }))
  on('session.cwd', () => ({ value: '/work/' }))
  const reply = props('```chart\n' + CHART + '\n```\n```chart\n' + CHART + '\n```')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: reply })
  const other = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: reply })
  const press = async (label: string) => ui.press({ key: (await ui.find({ type: 'Button', text: label }))!.key! })
  await press('Copy CSV')
  expect(copied).toEqual(['service,cost\nRDS,1854\nECS,1573'])
  expect(await ui.find({ type: 'Button', text: '✓ Copied' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Copy CSV' })).toBeDefined()
  expect(await other.find({ type: 'Button', text: '✓ Copied' })).toBeUndefined()
  await press('Save CSV')
  await press('Save SVG')
  expect(written.map(([path]) => path)).toEqual([expect.stringMatching(/^\/work\/cxm-chart-\w+\.csv$/), expect.stringMatching(/^\/work\/cxm-chart-\w+\.svg$/)])
  expect(written[0][1]).toBe('service,cost\nRDS,1854\nECS,1573\n')
  expect(written[1][1]).toMatch(/^<svg [\s\S]*\$1,854[\s\S]*<\/svg>\n$/)
  expect(await ui.find({ type: 'Button', text: `✓ Saved ${written[0][0]}` })).toBeDefined()
  const bad = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props('```chart\n{not json\n```') })
  expect(await bad.find({ type: 'Button' })).toBeUndefined()
})

test('a press that fails says why on its button', async ($, on) => {
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no clipboard' } }))
  const chart = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props('```chart\n' + CHART + '\n```') })
  await chart.press({ key: (await chart.find({ type: 'Button', text: 'Copy CSV' }))!.key! })
  expect(await chart.find({ type: 'Button', text: 'Not copied: no clipboard' })).toBeDefined()
  const table = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props('```row\n[{"type":"table","columns":["a"],"rows":[1,2]}]\n```') })
  await table.press({ key: (await table.find({ type: 'Button', text: 'Save CSV' }))!.key! })
  expect(await table.find({ type: 'Button', text: /^Not exported: / })).toBeDefined()
})
