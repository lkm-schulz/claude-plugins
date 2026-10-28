import type { ToolGroupCall } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { groupSummary } from '../hooks/group'
import { mount, shown, stubEngine } from './mount'

const read = (path: string, id = path): ToolGroupCall => ({
  tool_use_id: id,
  tool: 'Read',
  input: { file_path: path },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {},
})
const other = (tool: string, id: string): ToolGroupCall => ({ ...read('', id), tool, input: {} })

test('a group names the files it read, then counts the rest', () => {
  const calls = [read('/p/src/a.rs'), read('/p/b.rs'), other('Grep', 'g1'), other('Grep', 'g2'), other('Bash', 'b')]
  expect(groupSummary(calls, 80)).toBe('a.rs, b.rs · 2 searches · 1 command')
})

test('the names that do not fit are counted', () => {
  const calls = ['first.rs', 'second.rs', 'third.rs'].map(name => read(`/p/${name}`))
  expect(groupSummary(calls, 20)).toBe('first.rs, +2')
  expect(groupSummary(calls, 4)).toBe('+3')
})

test('a file read twice is named once', () => {
  expect(groupSummary([read('/p/a.rs', '1'), read('/p/a.rs', '2')], 80)).toBe('a.rs')
})

const group = { calls: [read('/p/a.rs', 't1'), other('Grep', 't2')], isActive: false, isExpanded: false, isCallsOnly: true }

test('a group is one line, and a press draws its calls beneath it', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'ToolGroup', group)
  expect(shown(await ui.drawn())).toBe('• Explored a.rs · 1 search ▸')

  await ui.press({ key: 'group' })
  expect(shown(await ui.drawn())).toBe('• Explored a.rs · 1 search ▾engine ToolGroup')
  await ui.unmount()
})

test('a group with a failed call is one line with a red bullet', async ($, on) => {
  stubEngine(on)
  const ui = await mount($, 'ToolGroup', { ...group, isCallsOnly: false, calls: [read('/p/a.rs', 't1'), { ...other('Bash', 't2'), isErrored: true }] })
  expect(shown(await ui.drawn())).toBe('• Explored a.rs · 1 command ▸')
  expect(await ui.find({ type: 'Text', text: '• ' })).toMatchObject({ props: { color: 'error' } })
  await ui.unmount()
})

test('a group of commands alone says it ran them', async ($, on) => {
  stubEngine(on)
  const command = (id: string, text: string): ToolGroupCall => ({ ...other('Bash', id), input: { command: text } })
  const ui = await mount($, 'ToolGroup', { ...group, calls: [command('c1', 'mkdir d1'), command('c2', 'touch d1/f')] })
  expect(shown(await ui.drawn())).toBe('• Ran mkdir d1, touch d1/f ▸')
  await ui.unmount()
})
