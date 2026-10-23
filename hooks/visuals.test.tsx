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
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', props: props(query('costs.total')) })
  expect(await ui.find({ type: 'Text', text: /\$1,854/ })).toBeDefined()
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
