import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { changedFilesOf, countSides, countsOf, isCreated, isPlain } from './changes'
import type { Counts } from './changes'
import { baseName, callAbove, fitNames, hasGap, rowColumns, toolRow } from './layout'
import type { Elements } from './layout'
import { commandSource, shellLines, shortCommand } from './shell'
import { fileUrl, fitEnd, shortPath, textWidth } from './text'

// The session's project root when the plugin first started in it: the folder
// Claude Code was started in, which the terminal resolves ctrl+click from.
// Kept in the session's state, so a reload does not take a moved root.
const startRoot = atom({ plugin: 'codex-style', key: 'startRoot' } as const, null)
const isOutputOpen = atom({ plugin: 'codex-style', key: 'isOutputOpen' } as const, false)
const isDiffOpen = atom({ plugin: 'codex-style', key: 'isDiffOpen' } as const, false)
// The run of edits each Edit or Write belongs to, by the run's first call, and
// each run's calls; whether a run's rows are drawn beneath its line.
const editRunOf = atom({ plugin: 'codex-style', key: 'editRunOf' } as const, null)
const editRun = atom({ plugin: 'codex-style', key: 'editRun' } as const, null)
const isRunOpen = atom({ plugin: 'codex-style', key: 'isRunOpen' } as const, false)

// The most lines an unfolded output draws; the rest are counted beneath.
export const SHOWN_LINES = 500

// The root paths are shown relative to: the one at the start, or the project
// root as it is now while the start is unrecorded.
const rootOf = async ($: EngineInterface) => (await read($, startRoot)) ?? (await $.session.root())

// Whether Claude Code runs in a dev container or a codespace, whose VS Code
// terminal opens a file:// URL on the machine outside it, where the file is
// not. Its own link on a path's text opens the file inside.
const isInContainer = async ($: EngineInterface) =>
  (await $.env.get('REMOTE_CONTAINERS')) === 'true' || (await $.env.get('CODESPACES')) === 'true'

// A file's path relative to the root (or `short`), cut to its end with `…`
// past `room` columns, and linked to the full path where a terminal can open
// it.
const pathText = async ($: EngineInterface, { Link, Text }: Elements, full: string, room: number, short?: string) => {
  short ??= shortPath(full, await rootOf($))
  const path = textWidth(short) > room ? `…${fitEnd(short, Math.max(room, 1) - 1)}` : short
  const href = fileUrl(full)
  return href === undefined || (await isInContainer($)) ? (
    <Text key="path" dimColor>
      {path}
    </Text>
  ) : (
    <Link key="path" href={href}>
      <Text dimColor>{path}</Text>
    </Link>
  )
}

// `+3 -1` in dim green and red.
const countsText = ({ Text }: Elements, counts: Counts) =>
  countSides(counts).flatMap((side, i) => [
    i > 0 && ' ',
    <Text key={side.color} color={side.color} dimColor>
      {side.text}
    </Text>,
  ])

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// The columns `• Verb ` takes.
const labelWidth = (verb: string) => textWidth(`• ${verb} `)

// Whether the plugin draws this row or result itself: a finished call on the
// terminal, outside the ctrl+o transcript, which shows every row in full.
const isCompact = (e: { surface: string; props: { isExpanded?: boolean } }) =>
  e.surface === 'terminal' && e.props.isExpanded !== true

const drawNothing = ({ Box }: Elements) => <Box />

export const registerRows: Register = on => {
  // `/cd` or a worktree move later moves the project root, but not the
  // terminal, so the root at the start is the one paths stay relative to.
  on('session.start', async ($, e, next) => {
    if ((await read($, startRoot)) === null) {
      const root = await $.session.root()
      await update($, startRoot, () => root)
    }
    return next(e)
  })

  // `• Read src/parser.rs :15-22`. The engine draws a running, failed or
  // interrupted read.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Read' } }, async ($, e, next) => {
    const input = e.props.input as { file_path?: unknown; offset?: unknown; limit?: unknown }
    if (!isCompact(e) || e.props.isRunning || e.props.isErrored || e.props.isInterrupted || typeof input.file_path !== 'string') {
      return next(e)
    }
    const elements = $.ui.resolve(e)
    const from = typeof input.offset === 'number' ? input.offset : undefined
    const to = from !== undefined && typeof input.limit === 'number' ? from + input.limit - 1 : undefined
    const range = from === undefined ? '' : `:${from}${to === undefined ? '' : `-${to}`}`
    const room = rowColumns(e) - labelWidth('Read') - textWidth(range)
    return toolRow(elements, { verb: 'Read', isErrored: false, hasGap: await hasGap($, e.props.tool_use_id) }, [
      <elements.Box key="file">
        {await pathText($, elements, input.file_path, room)}
        <elements.Text dimColor>{range}</elements.Text>
      </elements.Box>,
    ])
  })

  // The row says what was read; an error is the engine's to draw.
  on('ui.render', { component: 'ToolResult', props: { tool: 'Read' } }, ($, e, next) =>
    isCompact(e) && !e.props.isErrored ? drawNothing($.ui.resolve(e)) : next(e),
  )

  // Each Edit or Write joins the run of the one straight above it, or starts
  // one, and its counts are recorded once it is done: what the run's first row
  // sums up, as the rows are not handed each other's results.
  on('tool.call', { tool: /^(Edit|Write)$/ }, async ($, e, next) => {
    const path = (e as { file_path?: unknown }).file_path
    if (typeof path !== 'string') {
      return next(e)
    }
    const id = e.tool_use_id
    const above = await callAbove($, id)
    const aboveRun =
      above && (above.tool === 'Edit' || above.tool === 'Write')
        ? await read($, memberOf(editRunOf, { requestId: above.tool_use_id }))
        : null
    const runId = aboveRun ?? id
    const runRef = memberOf(editRun, { requestId: runId })
    await update($, memberOf(editRunOf, { requestId: id }), () => runId)
    await update($, runRef, run => ({
      calls: [...(run?.calls ?? []), { id, path, isCreated: false, isDone: false }],
    }))
    const result = await next(e)
    const output = 'result' in result ? result.result : undefined
    const counts = 'result' in result ? countsOf(result.isError === true, output) : undefined
    await update($, runRef, run => ({
      calls: (run?.calls ?? []).map(call =>
        call.id === id
          ? { ...call, counts, isCreated: isCreated(e as { old_string?: unknown }, output), isDone: true }
          : call,
      ),
    }))
    return result
  })

  for (const tool of ['Edit', 'Write']) {
    // `• Edited src/parser.rs ▸ +3 -1`: pressing the counts shows the diff
    // beneath the row (`▾`) and pressing again hides it. A change held for
    // review shows the path alone, the engine drawing the review beneath it.
    // A run of edits is one line, `• Edited a.md, b.md ▸ 3 edits +8 -2`, drawn
    // by its first row, the rows after it drawing nothing; pressing the fold
    // draws each row beneath it.
    on('ui.render', { component: 'ToolUse', props: { tool } }, async ($, e, next) => {
      const input = e.props.input as { file_path?: unknown; old_string?: unknown }
      if (!isCompact(e) || e.props.isRunning || e.props.isErrored || e.props.isInterrupted || typeof input.file_path !== 'string') {
        return next(e)
      }
      const id = e.props.tool_use_id
      const elements = $.ui.resolve(e)
      const { Box, Button, Text } = elements
      const counts = countsOf(false, e.props.output)
      const runId = await read($, memberOf(editRunOf, { requestId: id }))
      const run = runId === null ? null : await read($, memberOf(editRun, { requestId: runId }))
      const isRun = runId !== null && run !== null && run.calls.length > 1
      const isRunOpenRef = memberOf(isRunOpen, { requestId: runId ?? id })
      const isOpen = isRun && (await read($, isRunOpenRef))
      const gap = await hasGap($, id)

      const verb = isCreated(input, e.props.output) ? 'Created' : 'Edited'
      const isOpenRef = memberOf(isDiffOpen, { requestId: id })
      const fold = `${(await read($, isOpenRef)) ? '▾' : '▸'} `
      const countsWidth = counts ? textWidth(fold + countSides(counts).map(side => side.text).join(' ')) + 1 : 0
      const single = async (hasGap: boolean) =>
        toolRow(elements, { verb, isErrored: false, hasGap }, [
          await pathText($, elements, input.file_path as string, rowColumns(e) - labelWidth(verb) - countsWidth),
          counts && (
            <Button
              key="diff"
              label={`${fold}${countSides(counts).map(side => side.text).join(' ')}`}
              plain
              dimColor
              onPress={() => update($, isOpenRef, was => !was)}
            >
              <Text dimColor>{fold}</Text>
              {countsText(elements, counts)}
            </Button>
          ),
        ].filter(part => part !== undefined))

      if (!isRun || !counts) {
        return single(gap)
      }
      if (id !== runId) {
        return isOpen ? single(false) : <Box />
      }

      const calls = run.calls
      const total = calls.reduce(
        (sum, call) => ({ added: sum.added + (call.counts?.added ?? 0), removed: sum.removed + (call.counts?.removed ?? 0) }),
        { added: 0, removed: 0 },
      )
      const runVerb = calls.every(call => call.isCreated) ? 'Created' : 'Edited'
      const runFold = `${isOpen ? '▾' : '▸'} `
      const runLabel = [runFold + plural(calls.length, 'edit', 'edits'), ...countSides(total).map(side => side.text)].join(' ')
      const names = fitNames(
        [...new Set(calls.map(call => baseName(call.path)))],
        rowColumns(e) - labelWidth(runVerb) - textWidth(runLabel) - 1,
      )
      const header = toolRow(elements, { verb: runVerb, isErrored: false, hasGap: gap }, [
        <Text key="names" dimColor>
          {names}
        </Text>,
        <Button key="run" label={runLabel} plain dimColor onPress={() => update($, isRunOpenRef, was => !was)}>
          <Text dimColor>{`${runFold}${plural(calls.length, 'edit', 'edits')} `}</Text>
          {countsText(elements, total)}
        </Button>,
      ])
      return isOpen ? (
        <Box flexDirection="column">
          {header}
          {await single(true)}
        </Box>
      ) : (
        header
      )
    })

    // The counts are on the row, so the result beneath it draws nothing while
    // its diff is hidden, or its run is folded.
    on('ui.render', { component: 'ToolResult', props: { tool } }, async ($, e, next) => {
      const id = e.props.tool_use_id
      const runId = await read($, memberOf(editRunOf, { requestId: id }))
      const run = runId === null ? null : await read($, memberOf(editRun, { requestId: runId }))
      const isFolded = runId !== null && run !== null && run.calls.length > 1 && !(await read($, memberOf(isRunOpen, { requestId: runId })))
      const isHidden =
        isCompact(e) &&
        countsOf(e.props.isErrored, e.props.output) !== undefined &&
        (isFolded || !(await read($, memberOf(isDiffOpen, { requestId: id }))))
      return isHidden ? drawNothing($.ui.resolve(e)) : next(e)
    })
  }

  // `• Ran make docs ▸ 3 files +8 -2, 7 lines`, the command cut with `…` to
  // fit its line. Pressing the fold shows what it folds: the files the command
  // created, deleted or updated, the full command when the row cut it, and the
  // output. The engine draws a running, interrupted or backgrounded command,
  // an image, and an output saved to a file.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    const input = e.props.input as { command?: unknown }
    if (!isCompact(e) || e.props.isRunning || e.props.isInterrupted || typeof input.command !== 'string' || !isPlain(e.props.output)) {
      return next(e)
    }
    const command = input.command
    const elements = $.ui.resolve(e)
    const { Box, Button, Code, Text } = elements
    const lines = shellLines(e.props.output)
    const { files, moreFiles } = changedFilesOf(e.props.output)
    const fileCount = files.length + moreFiles
    const fileCounts = files.reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), {
      added: 0,
      removed: 0,
    })
    const isOpenRef = memberOf(isOutputOpen, { requestId: e.props.tool_use_id })
    const isOpen = await read($, isOpenRef)
    const fold = `${isOpen ? '▾' : '▸'} `

    // What the fold holds, as its label says it: `command, 3 files +8 -2, 7
    // lines`. Whether the command is cut decides the label, and the label the
    // command's room: measured with the longest label first.
    const labelOf = (isCut: boolean) =>
      [
        isCut && 'command',
        fileCount > 0 &&
          [plural(fileCount, 'file', 'files'), ...countSides(fileCounts).map(side => side.text)].join(' '),
        lines.length > 0 && plural(lines.length, 'line', 'lines'),
      ]
        .filter(part => typeof part === 'string')
        .join(', ')
    const room = (label: string) => rowColumns(e) - labelWidth('Ran') - (label ? textWidth(fold + label) + 1 : 0)
    const { text, isCut } = shortCommand(command, room(labelOf(true)))
    const label = labelOf(isCut)
    const filesPart = fileCount > 0 && [
      `${plural(fileCount, 'file', 'files')} `,
      ...countsText(elements, fileCounts),
    ]
    const labelParts = [isCut && 'command', filesPart, lines.length > 0 && plural(lines.length, 'line', 'lines')]
      .filter(part => part !== false)
      .flatMap((part, i) => (i > 0 ? [', ', part] : [part]))

    const root = await rootOf($)
    const shown = isOpen ? lines.slice(0, SHOWN_LINES) : []
    const opened = isOpen && (
      <Box key="opened" flexDirection="column" paddingLeft={4}>
        {files.map(file => (
          <Text key={`${file.change}:${file.path}`} dimColor>
            {file.change} {shortPath(file.path, root)} {countsText(elements, file)}
          </Text>
        ))}
        {moreFiles > 0 && <Text dimColor>+{moreFiles} more files</Text>}
        {isCut && (
          <Box>
            <Text dimColor>$ </Text>
            <Code source={commandSource(command)} language="bash" />
          </Box>
        )}
        {shown.map((line, i) => (
          <Text key={String(i)} color={e.props.isErrored ? 'error' : undefined} dimColor={!e.props.isErrored}>
            {line === '' ? ' ' : line}
          </Text>
        ))}
        {lines.length > shown.length && <Text dimColor>… +{lines.length - shown.length} lines</Text>}
      </Box>
    )
    return toolRow(
      elements,
      { verb: 'Ran', isErrored: e.props.isErrored, hasGap: await hasGap($, e.props.tool_use_id) },
      [
        <Text key="command" dimColor>
          {text}
        </Text>,
        label !== '' && (
          <Button key="output" label={fold + label} plain dimColor onPress={() => update($, isOpenRef, was => !was)}>
            <Text dimColor>{fold}</Text>
            {labelParts.map((part, i) => (
              <Text key={String(i)} dimColor>
                {part}
              </Text>
            ))}
          </Button>
        ),
      ].filter(part => part !== false),
      opened ? [opened] : [],
    )
  })

  // The row draws a plain output behind its fold, so the result draws nothing.
  on('ui.render', { component: 'ToolResult', props: { tool: 'Bash' } }, ($, e, next) =>
    isCompact(e) && isPlain(e.props.output) ? drawNothing($.ui.resolve(e)) : next(e),
  )

  // `• Stopped npm run dev`: the stopped task's command or description, cut
  // with `…` to fit its line, or its id where the result names neither. The
  // engine draws a running or failed stop.
  on('ui.render', { component: 'ToolUse', props: { tool: 'TaskStop' } }, async ($, e, next) => {
    const output = e.props.output as { command?: unknown; task_id?: unknown } | undefined
    if (!isCompact(e) || e.props.isRunning || e.props.isErrored || e.props.isInterrupted || typeof output !== 'object') {
      return next(e)
    }
    const elements = $.ui.resolve(e)
    const name = typeof output.command === 'string' && output.command.trim() !== '' ? output.command : String(output.task_id ?? '')
    return toolRow(elements, { verb: 'Stopped', isErrored: false, hasGap: await hasGap($, e.props.tool_use_id) }, [
      <elements.Text key="task" dimColor>
        {shortCommand(name, rowColumns(e) - labelWidth('Stopped')).text}
      </elements.Text>,
    ])
  })

  // The row names what was stopped, so the result draws nothing; an error is
  // the engine's to draw.
  on('ui.render', { component: 'ToolResult', props: { tool: 'TaskStop' } }, ($, e, next) =>
    isCompact(e) && !e.props.isErrored ? drawNothing($.ui.resolve(e)) : next(e),
  )

  // `• Read reference/format.md from Run Flow`, or `• Read 3 files from Run
  // Flow`: a read of an artifact's published files, linked to where the read
  // saved them, the artifact's title cut with `…` to fit its line. The engine
  // draws a running or failed read, a read with a file that failed, and every
  // other artifact call.
  on('ui.render', { component: 'ToolUse', props: { tool: 'Artifact' } }, async ($, e, next) => {
    const read = artifactRead(e.props.output)
    if (!isCompact(e) || e.props.isRunning || e.props.isErrored || e.props.isInterrupted || read === undefined) {
      return next(e)
    }
    const elements = $.ui.resolve(e)
    const room = rowColumns(e) - labelWidth('Read')
    const title = read.title?.trim() ? ` from ${read.title}` : ''
    // The files keep their room, but for the start of a title.
    const filesRoom = Math.min(textWidth(read.shown), title ? room - TITLE_START : room)
    const titleText = title && shortCommand(title.slice(1), room - filesRoom - 1).text
    return toolRow(elements, { verb: 'Read', isErrored: false, hasGap: await hasGap($, e.props.tool_use_id) }, [
      await pathText($, elements, read.savedTo, filesRoom, read.shown),
      titleText !== '' && (
        <elements.Text key="title" dimColor>
          {titleText}
        </elements.Text>
      ),
    ].filter(part => part !== false))
  })

  // The row names what was read and links to where; an error is the engine's
  // to draw.
  on('ui.render', { component: 'ToolResult', props: { tool: 'Artifact' } }, ($, e, next) =>
    isCompact(e) && !e.props.isErrored && artifactRead(e.props.output) !== undefined ? drawNothing($.ui.resolve(e)) : next(e),
  )
}

// The columns a row keeps for the start of an artifact's title: `from Run…`.
const TITLE_START = 16

// What a read of an artifact's published files names: one file's published
// path, or a count of files, the local path the read saved them to, and the
// artifact's title. Undefined for any other artifact call, and for a read
// where a file failed.
const artifactRead = (output: unknown) => {
  const { file_read: one, files_read: many } = (typeof output === 'object' && output !== null ? output : {}) as {
    file_read?: { path?: unknown; saved_to?: unknown; title?: unknown }
    files_read?: { files?: unknown; saved_dir?: unknown; title?: unknown }
  }
  const title = (one ?? many)?.title
  const named = { title: typeof title === 'string' ? title : undefined }
  if (one && typeof one.path === 'string' && typeof one.saved_to === 'string') {
    return { ...named, shown: one.path, savedTo: one.saved_to }
  }
  if (
    many &&
    Array.isArray(many.files) &&
    many.files.length > 0 &&
    many.files.every(file => typeof file === 'object' && file !== null && !('error' in file)) &&
    typeof many.saved_dir === 'string'
  ) {
    return { ...named, shown: plural(many.files.length, 'file', 'files'), savedTo: many.saved_dir }
  }
  return undefined
}
