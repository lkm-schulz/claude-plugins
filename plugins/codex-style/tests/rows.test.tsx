import type { SessionMessage, ToolUseSummary } from 'claude-code'
import { expect, test, type TestBody } from 'claude-code/testing'

import { mountResult, mountRow, ROOT, shown, stubEngine } from './mount'

const patch = (...lines: string[]) => [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }]
const edited = { type: 'update', filePath: `${ROOT}/a.md`, content: 'x', structuredPatch: patch('-old', '+new'), originalFile: 'old' }
const numbers = (n: number) => ({ stdout: `${Array.from({ length: n }, (_, i) => i + 1).join('\n')}\n`, stderr: '', interrupted: false })

const call = (tool_use_id: string, tool = 'Bash'): ToolUseSummary => ({ tool_use_id, tool, input: {} })
const reply = (text: string, ...toolUses: ToolUseSummary[]): SessionMessage => ({ role: 'assistant', text, toolUses })
const results = (): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: 'r', text: 'ok' } as NonNullable<SessionMessage['toolResults']>[number]],
})

test('a read is one line, its path relative and linked to the full one, its result hidden', async ($, on) => {
  stubEngine(on)
  const row = await mountRow($, 'Read', { input: { file_path: `${ROOT}/src/a.md`, offset: 15, limit: 8 }, output: {} })
  expect(shown(await row.drawn())).toBe('• Read src/a.md:15-22')
  expect(await row.find({ type: 'Link' })).toMatchObject({ props: { href: `file://${ROOT}/src/a.md` } })
  await row.unmount()

  const result = await mountResult($, 'Read', { output: {} })
  expect(shown(await result.drawn())).toBe('')
  await result.unmount()
})

test('a failed read is drawn by the engine', async ($, on) => {
  stubEngine(on)
  const row = await mountRow($, 'Read', { input: { file_path: `${ROOT}/a.md` }, isErrored: true, output: 'missing' })
  expect(shown(await row.drawn())).toBe('engine ToolUse')
  await row.unmount()
  const result = await mountResult($, 'Read', { isErrored: true, output: 'missing' })
  expect(shown(await result.drawn())).toBe('engine ToolResult')
  await result.unmount()
})

test('an edit shows its counts, which show and hide its diff on a press', async ($, on) => {
  stubEngine(on)
  const drawsDiff = async () => {
    const result = await mountResult($, 'Edit', { output: edited })
    const text = shown(await result.drawn())
    await result.unmount()
    return text === 'engine ToolResult'
  }

  const row = await mountRow($, 'Edit', { input: { file_path: `${ROOT}/a.md`, old_string: 'old' }, output: edited })
  expect(shown(await row.drawn())).toBe('• Edited a.md ▸ +1 -1')
  expect(await drawsDiff()).toBe(false)

  await row.press({ key: 'diff' })
  expect(shown(await row.drawn())).toBe('• Edited a.md ▾ +1 -1')
  expect(await drawsDiff()).toBe(true)

  await row.press({ key: 'diff' })
  expect(await drawsDiff()).toBe(false)
  await row.unmount()
})

test('a new file is created, with its added lines alone', async ($, on) => {
  stubEngine(on)
  const output = { type: 'create', filePath: `${ROOT}/a.md`, content: 'one\ntwo\n', structuredPatch: [], originalFile: null }
  const row = await mountRow($, 'Write', { input: { file_path: `${ROOT}/a.md` }, output })
  expect(shown(await row.drawn())).toBe('• Created a.md ▸ +2')
  await row.unmount()
})

test('a change held for review shows its path alone, the engine drawing the review', async ($, on) => {
  stubEngine(on)
  const output = { ...edited, staged: true }
  const row = await mountRow($, 'Edit', { input: { file_path: `${ROOT}/a.md` }, output })
  expect(shown(await row.drawn())).toBe('• Edited a.md')
  await row.unmount()
  const result = await mountResult($, 'Edit', { output })
  expect(shown(await result.drawn())).toBe('engine ToolResult')
  await result.unmount()
})

test('a command folds its output behind a press, its result drawing nothing', async ($, on) => {
  stubEngine(on)
  const row = await mountRow($, 'Bash', { input: { command: 'seq 1 3' }, output: numbers(3) })
  expect(shown(await row.drawn())).toBe('• Ran seq 1 3 ▸ 3 lines')

  await row.press({ key: 'output' })
  expect(shown(await row.drawn())).toBe('• Ran seq 1 3 ▾ 3 lines123')
  await row.unmount()

  const result = await mountResult($, 'Bash', { output: numbers(3) })
  expect(shown(await result.drawn())).toBe('')
  await result.unmount()
})

test('a command with no output has no fold', async ($, on) => {
  stubEngine(on)
  const row = await mountRow($, 'Bash', { input: { command: 'true' }, output: numbers(0) })
  expect(shown(await row.drawn())).toBe('• Ran true')
  expect(await row.find({ type: 'Button' })).toBeUndefined()
  await row.unmount()
})

test('a long command is cut to its line, and shown whole when its fold opens', async ($, on) => {
  stubEngine(on)
  const command = `echo ${'x'.repeat(200)}`
  const row = await mountRow($, 'Bash', { input: { command }, output: numbers(1) })
  const line = shown(await row.drawn())
  expect(line.endsWith('… ▸ command, 1 line')).toBe(true)
  expect(line.length).toBeLessThanOrEqual(78)

  await row.press({ key: 'output' })
  expect((await row.find({ type: 'Code' }))?.props).toMatchObject({ source: command })
  await row.unmount()
})

test('the files a command changed are counted on its line, and listed when its fold opens', async ($, on) => {
  stubEngine(on)
  const output = {
    ...numbers(2),
    bashEditDiff: {
      files: [
        { filePath: `${ROOT}/a.md`, created: true, hunks: [{ lines: ['+one', '+two'] }] },
        { filePath: `${ROOT}/b.md`, hunks: [{ lines: ['-old', '+new'] }] },
      ],
    },
  }
  const row = await mountRow($, 'Bash', { input: { command: 'make docs' }, output })
  expect(shown(await row.drawn())).toBe('• Ran make docs ▸ 2 files +3 -1, 2 lines')

  await row.press({ key: 'output' })
  expect(shown(await row.drawn())).toBe('• Ran make docs ▾ 2 files +3 -1, 2 linesCreated a.md +2Updated b.md +1 -112')
  await row.unmount()
})

test('an interrupted or backgrounded command is drawn by the engine', async ($, on) => {
  stubEngine(on)
  for (const output of [{ ...numbers(2), interrupted: true }, { ...numbers(0), backgroundTaskId: 'b1' }]) {
    const row = await mountRow($, 'Bash', { input: { command: 'sleep 9' }, output })
    expect(shown(await row.drawn())).toBe('engine ToolUse')
    await row.unmount()
    const result = await mountResult($, 'Bash', { output })
    expect(shown(await result.drawn())).toBe('engine ToolResult')
    await result.unmount()
  }
})

test('a running call and the ctrl+o transcript are drawn by the engine', async ($, on) => {
  stubEngine(on)
  const running = await mountRow($, 'Bash', { input: { command: 'ls' }, isRunning: true })
  expect(shown(await running.drawn())).toBe('engine ToolUse')
  await running.unmount()
  const expanded = await mountRow($, 'Bash', { input: { command: 'ls' }, output: numbers(1), isExpanded: true })
  expect(shown(await expanded.drawn())).toBe('engine ToolUse')
  await expanded.unmount()
  const result = await mountResult($, 'Edit', { output: edited, isExpanded: true })
  expect(shown(await result.drawn())).toBe('engine ToolResult')
  await result.unmount()
})

// The top margin of the row of call toolu_1 over `messages`, which read in the
// Messages API form are `apiMessages`.
const marginOver = async (...[$, on, messages, apiMessages = []]: [...Parameters<TestBody>, SessionMessage[], unknown[]?]) => {
  stubEngine(on, messages, {}, apiMessages)
  const row = await mountRow($, 'Bash', { input: { command: 'ls' }, output: numbers(0) })
  const margin = ((await row.drawn()) as { props?: { marginTop?: number } }).props?.marginTop
  await row.unmount()
  return margin
}

test('a row straight under another call sits right under it', async ($, on) => {
  expect(await marginOver($, on, [reply('', call('a')), results(), reply('', call('toolu_1'))])).toBe(0)
})

test('a row after text has a blank line above it', async ($, on) => {
  expect(await marginOver($, on, [reply('', call('a')), results(), reply('Next.', call('toolu_1'))])).toBe(1)
})

test('a row after thinking the transcript shows has a blank line above it', async ($, on) => {
  const messages = [reply('', call('a')), results(), reply('', call('toolu_1'))]
  const api = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'Found it.' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }] },
  ]
  expect(await marginOver($, on, messages, api)).toBe(1)
})

test('a row after thinking the transcript hides sits right under the call above', async ($, on) => {
  const messages = [reply('', call('a')), results(), reply('', call('toolu_1'))]
  const api = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }] },
  ]
  expect(await marginOver($, on, messages, api)).toBe(0)
})

test('a row the transcript does not hold has a blank line above it', async ($, on) => {
  expect(await marginOver($, on, [])).toBe(1)
})

test('a tool row is drawn dim, all but a failed command\'s red bullet', async ($, on) => {
  stubEngine(on)
  const output = {
    ...numbers(2),
    bashEditDiff: { files: [{ filePath: `${ROOT}/a.md`, hunks: [{ lines: ['-old', '+new'] }] }] },
  }
  const rows = [
    await mountRow($, 'Read', { input: { file_path: `${ROOT}/a.md` }, output: {} }),
    await mountRow($, 'Edit', { input: { file_path: `${ROOT}/a.md`, old_string: 'old' }, output: edited }),
    await mountRow($, 'Bash', { input: { command: 'make' }, output, isErrored: true }),
  ]
  for (const row of rows) {
    // A Text with no dim of its own is dim where it sits inside a dim one.
    const texts = (await row.findAll({ type: 'Text' })).filter(text => text.children.some(child => typeof child === 'string'))
    const bright = texts.filter(text => text.props.dimColor !== true && text.props.color !== 'error')
    expect(bright.map(text => text.text)).toEqual([])
    await row.unmount()
  }
})

// Makes Edit calls `ids`, one after another, each answered with `edited` and
// each straight after the one before in the transcript, as a session does
// before it draws their rows.
const makeEdits = async (...[$, on, ids]: [...Parameters<TestBody>, string[]]) => {
  const messages: SessionMessage[] = []
  stubEngine(on, messages)
  on('tool.call', { tool: 'Edit' }, () => ({ result: edited as never }))
  for (const id of ids) {
    messages.push(reply('', { tool_use_id: id, tool: 'Edit', input: {} }), results())
    await $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: `${ROOT}/${id}.md`, old_string: 'old', new_string: 'new' } as never)
  }
}

const editRow = ($: Parameters<TestBody>[0], id: string) =>
  mountRow($, 'Edit', { tool_use_id: id, input: { file_path: `${ROOT}/${id}.md`, old_string: 'old' }, output: edited })

test('a run of edits is one line on its first row, the rows after it drawing nothing', async ($, on) => {
  await makeEdits($, on, ['a', 'b', 'c'])

  const first = await editRow($, 'a')
  expect(shown(await first.drawn())).toBe('• Edited a.md, b.md, c.md ▸ 3 edits +3 -3')
  const later = await editRow($, 'b')
  expect(shown(await later.drawn())).toBe('')
  const result = await mountResult($, 'Edit', { tool_use_id: 'b', output: edited })
  expect(shown(await result.drawn())).toBe('')

  await first.press({ key: 'run' })
  expect(shown(await first.drawn())).toBe('• Edited a.md, b.md, c.md ▾ 3 edits +3 -3• Edited a.md ▸ +1 -1')
  expect(shown(await later.drawn())).toBe('• Edited b.md ▸ +1 -1')
  for (const ui of [first, later, result]) {
    await ui.unmount()
  }
})

test('an edit after text starts a run of its own', async ($, on) => {
  const messages: SessionMessage[] = []
  stubEngine(on, messages)
  on('tool.call', { tool: 'Edit' }, () => ({ result: edited as never }))
  messages.push(reply('', { tool_use_id: 'a', tool: 'Edit', input: {} }), results())
  await $.tool.call({ tool: 'Edit', tool_use_id: 'a', file_path: `${ROOT}/a.md`, old_string: 'old', new_string: 'new' } as never)
  messages.push(reply('Now the next file.', { tool_use_id: 'b', tool: 'Edit', input: {} }), results())
  await $.tool.call({ tool: 'Edit', tool_use_id: 'b', file_path: `${ROOT}/b.md`, old_string: 'old', new_string: 'new' } as never)

  for (const id of ['a', 'b']) {
    const row = await editRow($, id)
    expect(shown(await row.drawn())).toBe(`• Edited ${id}.md ▸ +1 -1`)
    await row.unmount()
  }
})

test('a stopped task is one line naming its command, its result hidden', async ($, on) => {
  stubEngine(on)
  const stopped = { message: 'Successfully stopped task: b1 (sleep 60)', task_id: 'b1', task_type: 'local_bash', command: 'sleep 60\n  && echo done' }
  const row = await mountRow($, 'TaskStop', { input: { task_id: 'b1' }, output: stopped })
  expect(shown(await row.drawn())).toBe('• Stopped sleep 60 && echo done')
  await row.unmount()

  const result = await mountResult($, 'TaskStop', { output: stopped })
  expect(shown(await result.drawn())).toBe('')
  await result.unmount()
})

test('a stopped task without a command is named by its id', async ($, on) => {
  stubEngine(on)
  const row = await mountRow($, 'TaskStop', { input: { task_id: 'b1' }, output: { message: 'stopped', task_id: 'b1', task_type: 'local_agent' } })
  expect(shown(await row.drawn())).toBe('• Stopped b1')
  await row.unmount()
})

test('a running or failed stop is drawn by the engine', async ($, on) => {
  stubEngine(on)
  const running = await mountRow($, 'TaskStop', { input: { task_id: 'b1' }, isRunning: true })
  expect(shown(await running.drawn())).toBe('engine ToolUse')
  await running.unmount()
  const failed = await mountRow($, 'TaskStop', { input: { task_id: 'b1' }, isErrored: true, output: 'No task found' })
  expect(shown(await failed.drawn())).toBe('engine ToolUse')
  await failed.unmount()
  const result = await mountResult($, 'TaskStop', { isErrored: true, output: 'No task found' })
  expect(shown(await result.drawn())).toBe('engine ToolResult')
  await result.unmount()
})

const SAVED = '/tmp/scratchpad/artifact-files/b39'
const fileRead = (path: string, title?: string) => ({ file_read: { path, saved_to: `${SAVED}/${path}`, title, ver: '1', size_bytes: 11, content_type: 'text/markdown', sha256: 'x' } })
const filesRead = (files: unknown[], title?: string) => ({ files_read: { url: 'u', title, ver: '1', saved_dir: SAVED, files } })
const savedFile = (path: string) => ({ path, saved_to: `${SAVED}/${path}`, size_bytes: 1, content_type: 'text/html', sha256: 'x' })

test("a read of an artifact's file names its published path and title, linked to where it was saved, its result hidden", async ($, on) => {
  stubEngine(on)
  const output = fileRead('artifact-type/reference/format.md', 'Run Flow')
  const row = await mountRow($, 'Artifact', { input: { action: 'read', path: 'artifact-type/reference/format.md' }, output })
  expect(shown(await row.drawn())).toBe('• Read artifact-type/reference/format.md from Run Flow')
  expect(await row.find({ type: 'Link' })).toMatchObject({ props: { href: `file://${SAVED}/artifact-type/reference/format.md` } })
  await row.unmount()

  const result = await mountResult($, 'Artifact', { output })
  expect(shown(await result.drawn())).toBe('')
  await result.unmount()
})

test("a read of an artifact's files counts them, linked to the folder they were saved under", async ($, on) => {
  stubEngine(on)
  const output = filesRead(['index.html', 'a.css', 'b.js'].map(savedFile), 'Umbra Project and Run Flow')
  const row = await mountRow($, 'Artifact', { input: { action: 'read', paths: ['index.html', 'a.css', 'b.js'] }, output })
  expect(shown(await row.drawn())).toBe('• Read 3 files from Umbra Project and Run Flow')
  expect(await row.find({ type: 'Link' })).toMatchObject({ props: { href: `file://${SAVED}` } })
  await row.unmount()
})

test("a long artifact title is cut to fit, before the file's path is", async ($, on) => {
  stubEngine(on)
  const output = fileRead('reference/format.md', 'A Very Long Artifact Title That Goes On And On Past The Edge Of Any Line')
  const row = await mountRow($, 'Artifact', { input: { action: 'read' }, output })
  const text = shown(await row.drawn())
  expect(text.startsWith('• Read reference/format.md from A Very')).toBe(true)
  expect(text.endsWith('…')).toBe(true)
  expect(text.length).toBe(78)
  await row.unmount()
})

test('an artifact read with a failed file, and any other artifact call, are drawn by the engine', async ($, on) => {
  stubEngine(on)
  const failed = filesRead([savedFile('index.html'), { path: 'gone.css', error: 'not found' }], 'Run Flow')
  const published = { url: 'https://claude.ai/artifact/x', path: 'page.html', title: 'Run Flow' }
  for (const output of [failed, published]) {
    const row = await mountRow($, 'Artifact', { input: { action: 'read' }, output })
    expect(shown(await row.drawn())).toBe('engine ToolUse')
    await row.unmount()
    const result = await mountResult($, 'Artifact', { output })
    expect(shown(await result.drawn())).toBe('engine ToolResult')
    await result.unmount()
  }
})
