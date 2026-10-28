import { expect, test, type TestBody } from 'claude-code/testing'

import { formatDuration, mutedColor, parseColor } from '../hooks/messages'
import { mount, shown, stubEngine } from './mount'

test('the person’s prompt opens with ›', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'UserMessage', { text: 'fix the test', origin: { kind: 'composer' }, isExpanded: true } as never)
  expect(shown(await ui.drawn())).toBe('› fix the test')
  await ui.unmount()
})

test('the prompt is shaded with the theme’s own background for the person’s messages', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'UserMessage', { text: 'fix it', origin: { kind: 'composer' }, isExpanded: true } as never)
  expect(((await ui.drawn()) as { props?: { backgroundColor?: string } }).props?.backgroundColor).toBe('userMessageBackground')
  await ui.unmount()
})

test('the prompt’s › sits in the first column, so its text lines up with a reply’s', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'UserMessage', { text: 'fix it', origin: { kind: 'composer' }, isExpanded: true } as never)
  const props = ((await ui.drawn()) as { props?: { paddingX?: number; paddingLeft?: number } }).props
  expect(props?.paddingX ?? props?.paddingLeft ?? 0).toBe(0)
  await ui.unmount()
})

const notification = (task: object, isExpanded = false) =>
  ({ text: 'Background command "make docs" completed (exit code 0)', origin: { kind: 'task-notification' }, isExpanded, task }) as never

test('a task notification is a dim row, its run time after it', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'UserMessage', notification({ status: 'killed', durationMs: 122_000 }))
  expect(shown(await ui.drawn())).toBe('• Background command "make docs" completed (exit code 0) 2m 2s')
  expect(await ui.find({ type: 'Text', text: '• ' })).toMatchObject({ props: { dimColor: true } })
  await ui.unmount()
})

test('a completed task’s bullet is green, a failed one’s red', async ($, on) => {
  stubEngine(on)
  for (const [status, color] of [['completed', 'success'], ['failed', 'error']]) {
    const ui = await mount($, 'UserMessage', notification({ status }))
    expect(await ui.find({ type: 'Text', text: '• ' })).toMatchObject({ props: { color, dimColor: false } })
    await ui.unmount()
  }
})

test('a long task notification is cut to its line', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'UserMessage', { ...(notification({}) as object), text: `Background command "${'x'.repeat(200)}" completed` } as never)
  const text = shown(await ui.drawn())
  expect(text.endsWith('…')).toBe(true)
  expect(text.length).toBe(78)
  await ui.unmount()
})

test('a task notification in the ctrl+o transcript keeps the engine’s drawing', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'UserMessage', notification({ status: 'completed' }, true))
  expect(shown(await ui.drawn())).toBe('engine UserMessage')
  await ui.unmount()
})

// Stubs the theme `/config` holds and, for a custom one, its file.
const stubTheme = (on: Parameters<TestBody>[1], theme: string, file?: object) => {
  stubEngine(on, [], { HOME: '/home/me' })
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] }) as never)
  on('fs.read', () => (file ? { value: JSON.stringify(file) } : { deny: 'missing' }) as never)
}

// The reply style that draws a bar down a reply's left edge.
const BAR = { options: { replyStyle: 'bar' } }

const barOf = async ($: Parameters<TestBody>[0], isFirstOfReply = true) => {
  const ui = await mount($, 'AssistantMessage', { text: 'Fixed `parse`.', isFirstOfReply })
  const drawn = { text: shown(await ui.drawn()), bar: (await ui.find({ key: 'bar' }))?.props, markdown: await ui.find({ type: 'Markdown' }) }
  await ui.unmount()
  return drawn
}

test('a reply opens with a bullet in the first column, a block after its first lined up under its text', async ($, on) => {
  stubEngine(on)
  for (const [isFirstOfReply, mark] of [[true, '• '], [false, '  ']] as const) {
    const ui = await mount($, 'AssistantMessage', { text: 'Fixed `parse`.', isFirstOfReply })
    expect(shown(await ui.drawn())).toBe(`${mark}Fixed \`parse\`.`)
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()
    expect(await ui.find({ key: 'bar' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a reply is drawn as markdown beside a bar, a block after its first too', BAR, async ($, on) => {
  stubTheme(on, 'dark')
  for (const isFirstOfReply of [true, false]) {
    const { text, bar, markdown } = await barOf($, isFirstOfReply)
    expect(text).toBe('Fixed `parse`.')
    expect(markdown).toBeDefined()
    expect(bar).toMatchObject({ width: 1 })
  }
})

test('the bar is a built-in theme’s Claude colour, muted toward its background', BAR, async ($, on) => {
  stubTheme(on, 'dark')
  // rgb(215,119,87) halfway to rgb(26,26,26).
  expect((await barOf($)).bar).toMatchObject({ backgroundColor: '#794939' })
})

test('the bar is a custom theme’s own Claude colour, muted', BAR, async ($, on) => {
  stubTheme(on, 'custom:mine', { base: 'dark', overrides: { claude: '#d2a8ff' } })
  expect((await barOf($)).bar).toMatchObject({ backgroundColor: '#76618d' })
})

test('a custom theme with no Claude colour of its own takes its base’s, muted toward a light background', BAR, async ($, on) => {
  stubTheme(on, 'custom:mine', { base: 'light', overrides: {} })
  // rgb(215,119,87) halfway to white.
  expect((await barOf($)).bar).toMatchObject({ backgroundColor: '#ebbbab' })
})

test('an ANSI theme, or a theme file that cannot be read, draws the bar in the theme’s Claude colour', BAR, async ($, on) => {
  stubTheme(on, 'custom:gone')
  expect((await barOf($)).bar).toMatchObject({ backgroundColor: 'claude' })
})

test('colours read as channels from hex and rgb spellings alone', () => {
  expect(parseColor('#d2a8ff')).toEqual([210, 168, 255])
  expect(parseColor('#fa0')).toEqual([255, 170, 0])
  expect(parseColor('rgb(215, 119, 87)')).toEqual([215, 119, 87])
  expect(parseColor('ansi:redBright')).toBeUndefined()
  expect(mutedColor('ansi:redBright', false)).toBe('claude')
})

test('a summary of the model’s thinking is faint markdown after a faint ∴, with no bar', async ($, on) => {
  stubTheme(on, 'dark')
  const ui = await mount($, 'AssistantMessage', { text: 'Since `x` is USD-only, skip it.', isFirstOfReply: true, isSummary: true })
  expect(shown(await ui.drawn())).toBe('∴ Since `x` is USD-only, skip it.')
  expect(await ui.find({ type: 'Text', text: '∴ ' })).toMatchObject({ props: { dimColor: true } })
  expect(await ui.find({ type: 'Markdown' })).toMatchObject({ props: { dimColor: true } })
  expect(await ui.find({ key: 'bar' })).toBeUndefined()
  await ui.unmount()
})

test('the turn ends with a rule saying how long it worked', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'TurnDuration', { word: 'Baked', durationMs: 42_000 })
  const line = shown(await ui.drawn())
  expect(line.startsWith('─ Worked for 42s ──')).toBe(true)
  expect(line.length).toBe(80)
  await ui.unmount()
})

test('a duration reads as the engine writes it', () => {
  expect(formatDuration(3_000)).toBe('3s')
  expect(formatDuration(64_000)).toBe('1m 4s')
  expect(formatDuration(7_205_000)).toBe('2h 0m 5s')
})

test('the spinner says Working, whatever word the turn sampled', async ($, on) => {
  let word: string | undefined
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    word = e.props.word
    const { Text } = $.ui.resolve(e)
    return <Text>engine Spinner</Text>
  })
  const ui = await mount($, 'Spinner', { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' })
  await ui.drawn()
  expect(word).toBe('Working')
  await ui.unmount()
})

test('a desktop’s spinner keeps the step it names', async ($, on) => {
  let word: string | undefined
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    word = e.props.word
    const { Text } = $.ui.resolve(e)
    return <Text>engine Spinner</Text>
  })
  const ui = await mount($, 'Spinner', { word: 'Creating notes.md', message: null, suffix: '…', mode: 'tool-use' }, 'desktop' as 'terminal')
  await ui.drawn()
  expect(word).toBe('Creating notes.md')
  await ui.unmount()
})
