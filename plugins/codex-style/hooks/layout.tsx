import type { EngineInterface, RenderNode, SessionMessage, ToolUseSummary } from 'claude-code'

import { textWidth } from './text'

// The elements a surface draws with, as `$.ui.resolve(e)` hands them out.
export type Elements = ReturnType<EngineInterface['ui']['resolve']>

// What opens every row: replies' and tool calls' alike.
export const BULLET = '• '

// Columns kept free at a line's end, so a row the engine indents a little
// (a subagent's, the fullscreen layout's) still fits on one line.
const SLACK = 2

// The terminal's columns, 80 where the surface has not measured.
export const lineColumns = (e: { viewport?: { columns: number } }) => e.viewport?.columns ?? 80

// The columns a row has.
export const rowColumns = (e: { viewport?: { columns: number } }) => lineColumns(e) - SLACK

// A tool call's row: `• Ran ls -la`, drawn dim so the replies stand out,
// its bullet red for a call that failed (green for a background task that
// succeeded), then whatever follows on the line (each part dim itself), then
// the lines beneath it.
export const toolRow = (
  { Box, Text }: Elements,
  row: { verb: string; isErrored: boolean; isSucceeded?: boolean; hasGap: boolean },
  line: RenderNode[],
  below: RenderNode[] = [],
) => (
  <Box flexDirection="column" marginTop={marginOver(row.hasGap)}>
    <Box>
      <Text
        color={row.isErrored ? 'error' : row.isSucceeded ? 'success' : undefined}
        dimColor={!row.isErrored && !row.isSucceeded}
      >
        {BULLET}
      </Text>
      <Text dimColor>{row.verb}</Text>
      {line.flatMap((part, i) => [
        <Text key={`gap${i}`} dimColor>
          {' '}
        </Text>,
        part,
      ])}
    </Box>
    {below}
  </Box>
)

// The call drawn straight above each call, by its tool_use_id, or null for a
// call after text or a prompt. Kept once known, in the module, so a reload
// works them out again.
const callsAbove = new Map<string, ToolUseSummary | null>()

// Records, for every tool call in `messages`, the call drawn straight above
// it. A reply's text breaks a run, and so do a prompt and thinking the
// transcript shows (`∴ Found it.`, a call in `afterThinking`); results (a user
// message carrying tool results, and the reminders beside them) and thinking
// with no text draw nothing between the rows and are passed over. Returns the
// last call when nothing breaks the run after it: the call above one not yet
// recorded.
export const recordCallsAbove = (
  messages: SessionMessage[],
  into: Map<string, ToolUseSummary | null>,
  afterThinking: ReadonlySet<string> = new Set(),
) => {
  let above: ToolUseSummary | null = null
  for (const message of messages) {
    if (message.role === 'user') {
      if (!message.toolResults?.length) {
        above = null
      }
      continue
    }
    if (message.text.trim() !== '') {
      above = null
    }
    for (const call of message.toolUses) {
      into.set(call.tool_use_id, afterThinking.has(call.tool_use_id) ? null : above)
      above = call
    }
  }
  return above
}

// The ids of the calls straight after thinking with text, which the
// transcript shows. A SessionMessage leaves thinking out, so this reads the
// Messages API form.
export const callsAfterThinking = (messages: { content: { type: string; [field: string]: unknown }[] }[]) => {
  const ids = new Set<string>()
  let isAfterThinking = false
  for (const block of messages.flatMap(message => message.content)) {
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '') {
      isAfterThinking = true
    } else if (block.type === 'tool_use') {
      if (isAfterThinking && typeof block.id === 'string') {
        ids.add(block.id)
      }
      isAfterThinking = false
    }
  }
  return ids
}

// Every call's call above, as recordCallsAbove records them, from the
// transcript read afresh. A function declaration: the engine follows `$`
// into an imported function only when it is one.
async function readCallsAbove($: EngineInterface, into: Map<string, ToolUseSummary | null>) {
  const [messages, api] = await Promise.all([$.session.messages(), $.session.messages({ as: 'api' })])
  return recordCallsAbove(messages, into, 'deny' in api ? new Set() : callsAfterThinking(api))
}

// The call drawn straight above a call, or null: read afresh, for a call
// being made.
export async function callAbove($: EngineInterface, id: string) {
  const into = new Map<string, ToolUseSummary | null>()
  try {
    const last = await readCallsAbove($, into)
    return into.has(id) ? (into.get(id) ?? null) : last
  } catch {
    return null
  }
}

// Whether a call's row has a blank line above it: one after text or a
// prompt, and one the transcript does not hold (yet, or at all: a subagent's,
// one older than the newest entries it returns), or cannot be read. A row
// straight under another call sits right under it. The engine draws no blank
// line of its own above a row a hook drew.
export async function hasGap($: EngineInterface, id: string) {
  if (!callsAbove.has(id)) {
    try {
      await readCallsAbove($, callsAbove)
    } catch {
      return true
    }
  }
  return (callsAbove.get(id) ?? null) === null
}

// The margin over a row: a blank line, or none.
export const marginOver = (hasGap: boolean) => (hasGap ? 1 : 0)

// `a.md, b.md, +2`: as many names as fit in `room` columns, and a count of
// the rest.
export const fitNames = (names: string[], room: number) => {
  let fit = ''
  for (const [i, name] of names.entries()) {
    const next = `${fit}${i > 0 ? ', ' : ''}${name}`
    const rest = names.length - i - 1
    if (textWidth(next + (rest > 0 ? `, +${rest}` : '')) > room) {
      return i === 0 ? `+${names.length}` : `${fit}, +${names.length - i}`
    }
    fit = next
  }
  return fit
}

// The file name at the end of a path, either separator.
export const baseName = (path: string) => path.split(/[\\/]/).pop() || path
