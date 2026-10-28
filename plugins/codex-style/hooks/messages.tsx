import type { EngineInterface, Register } from 'claude-code'

import { BULLET, lineColumns, rowColumns, toolRow, type Elements } from './layout'
import { shortCommand } from './shell'
import { textWidth } from './text'

// Rows the person wrote; peers' and teammates' messages keep the engine's
// drawing.
const OWN_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

// What opens the person's prompt.
const PROMPT_MARK = '› '

// What opens a summary of the model's thinking.
const THOUGHT_MARK = '∴ '

// The shading behind the person's prompt: the theme's own, which a custom
// theme can set.
const PROMPT_BACKGROUND = 'userMessageBackground'

// The bar down a reply's left edge: the theme's Claude colour (the spinner's)
// mixed halfway toward the background. No theme key names a muted one, and
// the plugin is handed theme keys, not their values: so the values come from
// the built-in themes' (copied from Claude Code 2.1.310) and a custom theme's
// file. An ANSI theme's colour cannot be mixed and is drawn as it is.
const BUILTIN_CLAUDE: Record<string, string> = {
  dark: 'rgb(215,119,87)',
  light: 'rgb(215,119,87)',
  'dark-daltonized': 'rgb(255,153,51)',
  'light-daltonized': 'rgb(255,153,51)',
}
const BAR_MIX = 0.5
const BACKGROUND = { dark: [26, 26, 26], light: [255, 255, 255] } as const

// `#rrggbb`, `#rgb` or `rgb(r, g, b)` as its channels; undefined for any
// other spelling (`ansi:red`, `ansi256(9)`).
export const parseColor = (color: string): [number, number, number] | undefined => {
  const rgb = /^rgb\(\s?(\d{1,3}),\s?(\d{1,3}),\s?(\d{1,3})\s?\)$/.exec(color)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color)?.[1]
  if (!hex) {
    return undefined
  }
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

// `color` mixed toward a dark or light background by BAR_MIX, as `#rrggbb`;
// the theme's own Claude colour where `color` is no RGB value.
export const mutedColor = (color: string | undefined, isLight: boolean) => {
  const channels = color === undefined ? undefined : parseColor(color)
  if (!channels) {
    return 'claude'
  }
  const toward = isLight ? BACKGROUND.light : BACKGROUND.dark
  return `#${channels.map((c, i) => Math.round(c + (toward[i]! - c) * BAR_MIX).toString(16).padStart(2, '0')).join('')}`
}

// The reply bar's colour for the theme `/config` holds: a built-in theme's
// Claude colour, or a custom theme's (`custom:<name>`, its file in the
// config folder's `themes`), its override or its base's, muted. `auto`
// follows the terminal, which the plugin cannot read, so it is taken as dark.
// A function declaration: the engine follows `$` into a function only when it
// is one.
export async function replyBarColor($: EngineInterface) {
  try {
    const setting = (await $.config.list()).find(row => row.key === 'theme')?.value
    const name = typeof setting === 'string' ? setting : 'dark'
    if (!name.startsWith('custom:')) {
      return mutedColor(BUILTIN_CLAUDE[name === 'auto' ? 'dark' : name], name.startsWith('light'))
    }
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
    const theme = JSON.parse(await $.fs.read(`${configDir}/themes/${name.slice('custom:'.length)}.json`)) as {
      base?: unknown
      overrides?: { claude?: unknown }
    }
    const base = typeof theme.base === 'string' ? theme.base : 'dark'
    const claude = typeof theme.overrides?.claude === 'string' ? theme.overrides.claude : BUILTIN_CLAUDE[base]
    return mutedColor(claude, base.startsWith('light'))
  } catch {
    return 'claude'
  }
}

// A paste reaches the model wrapped as `<pasted_content id="…">` …
// `</pasted_content id="…">`, with tags of that name inside it escaped as
// `<\pasted_content` and `<\/pasted_content`. The engine pads the wrapper with
// blank lines, so the newlines around it are taken as part of it.
const PASTE = /\n*<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">\n*/g
const ESCAPED_TAG = /<\\(\\*\/?pasted_content\b)/g

// The prompt as the person pasted it: each paste's wrapper and padding
// dropped, the paste on lines of its own, and the tags inside it unescaped
// once.
export const unwrapPastes = (text: string) =>
  text.replace(PASTE, (wrapped: string, _id, body: string, at: number) => {
    const end = at + wrapped.length
    const before = at > 0 ? '\n' : ''
    const after = end < text.length && !text.startsWith('<pasted_content id="', end) ? '\n' : ''
    return before + body.replace(ESCAPED_TAG, '<$1') + after
  })

// A duration as the engine's line writes it: `3s`, `1m 4s`, `2h 0m 5s`.
export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

// A block of markdown after a mark in the first column, its lines wrapping
// beside the mark: `• Fixed it.`, `∴ Found it.`.
const markedBlock = ({ Box, Markdown, Text }: Elements, mark: string, text: string, isFaint: boolean) => (
  <Box marginTop={1} width="100%">
    <Box width={textWidth(mark)} flexShrink={0}>
      <Text dimColor={isFaint}>{mark}</Text>
    </Box>
    <Box flexGrow={1} flexShrink={1} flexDirection="column">
      <Markdown text={text} dimColor={isFaint} />
    </Box>
  </Box>
)

export const registerMessages: Register = (on, options) => {
  // `• Background command "make docs" completed 2m 2s`: a background task's
  // notification as a tool row, cut with `…` to fit its line, its bullet
  // green for a task that completed and red for one that failed. The ctrl+o
  // transcript keeps the engine's drawing.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'task-notification' || e.props.isExpanded || e.props.text.trim() === '') {
      return next(e)
    }
    const elements = $.ui.resolve(e)
    const { status, durationMs } = e.props.task ?? {}
    const duration = durationMs === undefined ? '' : formatDuration(durationMs)
    const room = rowColumns(e) - textWidth('• ') - (duration ? textWidth(duration) + 1 : 0)
    const row = { verb: shortCommand(e.props.text, room).text, isErrored: status === 'failed', isSucceeded: status === 'completed', hasGap: true }
    return toolRow(elements, row, duration ? [<elements.Text key="duration" dimColor>{duration}</elements.Text>] : [])
  })

  // `› fix the failing parser test` on a shaded band across the line, so the
  // person's own lines stand out from the replies. The `›` sits in the first
  // column, where a reply's bar and a row's bullet sit, so the text lines up
  // with theirs.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const text = unwrapPastes(e.props.text.replace(/\r\n?/g, '\n')).replace(/\s+$/, '')
    if (e.surface !== 'terminal' || !OWN_ORIGINS.has(e.props.origin.kind) || text === '') {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box marginTop={1} width="100%" paddingRight={1} backgroundColor={PROMPT_BACKGROUND}>
        <Box width={textWidth(PROMPT_MARK)} flexShrink={0}>
          <Text bold color="suggestion" backgroundColor={PROMPT_BACKGROUND}>
            {PROMPT_MARK}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="wrap" backgroundColor={PROMPT_BACKGROUND}>
            {text}
          </Text>
        </Box>
      </Box>
    )
  })

  // `• I'll look at the test first.`, as Codex draws a reply, a block after
  // the reply's first lined up under its text; or, with `replyStyle` `bar`,
  // `▌ I'll look at the test first.`: a muted accent bar down the reply's left
  // edge, where the tool rows draw their bullets, the reply drawn as the
  // engine draws it beside it. The bar is a coloured space, so text copied
  // from the terminal carries no bar character. A summary (the model's
  // thinking, as the API summarises it) is drawn faint after a `∴`, so it
  // reads as an aside to the reply.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const elements = $.ui.resolve(e)
    if (e.props.isSummary) {
      return markedBlock(elements, THOUGHT_MARK, e.props.text, true)
    }
    if (options.replyStyle !== 'bar') {
      return markedBlock(elements, e.props.isFirstOfReply ? BULLET : ' '.repeat(textWidth(BULLET)), e.props.text, false)
    }
    const { Box, Markdown } = elements
    const bar = await replyBarColor($)
    return (
      <Box marginTop={1} width="100%" alignItems="stretch">
        <Box key="bar" width={1} flexShrink={0} backgroundColor={bar} />
        <Box flexGrow={1} flexShrink={1} flexDirection="column" paddingLeft={1}>
          <Markdown text={e.props.text} />
        </Box>
      </Box>
    )
  })

  // `✻ Working… (12s)` in place of a word sampled for the turn
  // (`Sauteing`). A desktop's word names the step it is on and stays.
  on('ui.render', { component: 'Spinner' }, ($, e, next) =>
    next(e.surface === 'terminal' ? { ...e, props: { ...e.props, word: 'Working' } } : e),
  )

  // `─ Worked for 42s ───…` across the line. A line waiting on background
  // agents keeps the engine's drawing.
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.waitingFor) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const head = `─ Worked for ${formatDuration(e.props.durationMs)} `
    return (
      <Box marginTop={1}>
        <Text dimColor>{head + '─'.repeat(Math.max(0, lineColumns(e) - textWidth(head)))}</Text>
      </Box>
    )
  })
}
