import { atom, memberOf, read, update } from 'claude-code'
import type { Register, ToolGroupCall } from 'claude-code'

import { baseName, fitNames, hasGap, rowColumns, toolRow } from './layout'
import { shortCommand } from './shell'
import { fitWidth, textWidth } from './text'

const isGroupOpen = atom({ plugin: 'codex-style', key: 'isGroupOpen' } as const, false)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Whether a group holds commands alone, which it says it ran, not explored.
export const isCommandsOnly = (calls: readonly ToolGroupCall[]) => calls.every(call => call.tool === 'Bash')

// What a group of commands alone says after `Ran`: each command on one line,
// as many as fit: `mkdir d1, touch d1/f, +2`.
export const commandsSummary = (calls: readonly ToolGroupCall[], room: number) =>
  fitNames(
    calls.map(call => shortCommand(String((call.input as { command?: unknown }).command ?? ''), room).text),
    room,
  )

// What a group's line says after `Explored`, within `room` columns: the names
// of the files it read, as many as fit and `+2` for the rest, then the counts
// of everything else: `parser.rs, lexer.rs, +2 · 2 searches · 1 command`.
export const groupSummary = (calls: readonly ToolGroupCall[], room: number) => {
  const files = [
    ...new Set(
      calls
        .filter(call => call.tool === 'Read')
        .map(call => (call.input as { file_path?: unknown }).file_path)
        .filter((path): path is string => typeof path === 'string')
        .map(baseName),
    ),
  ]
  const count = (tools: string[]) => calls.filter(call => tools.includes(call.tool)).length
  const known = ['Read', 'Grep', 'Glob', 'Bash']
  const counts = [
    [count(['Grep']), 'search', 'searches'],
    [count(['Glob']), 'listing', 'listings'],
    [count(['Bash']), 'command', 'commands'],
    [calls.filter(call => !known.includes(call.tool)).length, 'other call', 'other calls'],
  ] as const
  const tail = counts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many))

  const tailText = tail.map(part => ` · ${part}`).join('')
  const names = files.length > 0 ? fitNames(files, room - textWidth(tailText)) : ''
  const text = names === '' ? tail.join(' · ') : names + tailText
  return textWidth(text) > room ? `${fitWidth(text, Math.max(room, 1) - 1)}…` : text
}

export const registerGroup: Register = on => {
  // `• Explored parser.rs, lexer.rs · 2 searches ▸`, or for commands alone
  // `• Ran mkdir d1, touch d1/f ▸`, in place of the engine's
  // `Read 2 files, searched 2 patterns`; pressing the fold draws the engine's
  // rows beneath it: each call's, and whatever else the group holds (a
  // recalled memory, a hook's timing). The bullet is red when a call failed.
  // The ctrl+o transcript keeps the engine's drawing.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const firstId = e.props.calls[0]?.tool_use_id
    if (e.surface !== 'terminal' || e.props.isExpanded || firstId === undefined) {
      return next(e)
    }
    const elements = $.ui.resolve(e)
    const { Box, Button } = elements
    const isOpenRef = memberOf(isGroupOpen, { requestId: firstId })
    const isOpen = await read($, isOpenRef)
    const isCommands = isCommandsOnly(e.props.calls)
    const verb = isCommands ? (e.props.isActive ? 'Running' : 'Ran') : e.props.isActive ? 'Exploring' : 'Explored'
    const fold = isOpen ? '▾' : '▸'
    const room = rowColumns(e) - textWidth(`• ${verb}  ${fold}`)
    const isErrored = e.props.calls.some(call => call.isErrored)
    const row = toolRow(elements, { verb, isErrored, hasGap: await hasGap($, firstId) }, [
      <elements.Text key="summary" dimColor>
        {(isCommands ? commandsSummary : groupSummary)(e.props.calls, room)}
      </elements.Text>,
      <Button key="group" label={fold} plain dimColor onPress={() => update($, isOpenRef, was => !was)} />,
    ])
    return isOpen ? (
      <Box flexDirection="column">
        {row}
        {await next({ ...e, props: { ...e.props, isExpanded: true } })}
      </Box>
    ) : (
      row
    )
  })
}
