import type { RenderComponent, RenderPropsOf } from 'claude-code'
import { mock, type Engine, type TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

export const ROOT = '/home/me/project'
const VIEWPORT = { columns: 80, rows: 24 }

// Mounts `component` through the plugin on an 80 column terminal.
export const mount = <C extends RenderComponent>($: Engine, component: C, props: RenderPropsOf[C], surface = 'terminal' as const) =>
  $.ui.mount({ plugin: 'codex-style', surface, component, props, viewport: VIEWPORT })

// Mounts a finished call's row.
export const mountRow = ($: Engine, tool: string, props: Partial<RenderPropsOf['ToolUse']> = {}) =>
  mount($, 'ToolUse', { tool_use_id: 'toolu_1', tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...props })

// Mounts the result beneath a finished call's row.
export const mountResult = ($: Engine, tool: string, props: Partial<RenderPropsOf['ToolResult']> = {}) =>
  mount($, 'ToolResult', { tool_use_id: 'toolu_1', tool, output: undefined, isErrored: false, ...props })

// The engine beneath draws every component as `engine <Component>`; the
// session's project root is ROOT, its environment `env` (none of a dev
// container's variables set), and its transcript holds `messages`, which
// read in the Messages API form are `apiMessages`.
export const stubEngine = (on: On, messages: unknown[] = [], env: Record<string, string> = {}, apiMessages: unknown[] = []) => {
  for (const component of ['ToolUse', 'ToolResult', 'ToolGroup', 'UserMessage', 'AssistantMessage', 'TurnDuration'] as const) {
    // One registration per component; cast, as a union does not narrow a matcher.
    on('ui.render', { component: component as 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine {component}</Text>
    })
  }
  on('session.root', () => ({ value: ROOT }))
  on('session.messages', ($, e) => ({ value: (e.as === 'api' ? apiMessages : messages) as never }))
  mock.env(on, env)
}

type Drawn = { type?: string; text?: string; children?: unknown[] } | string

// Everything a drawing shows, its texts and labels joined in document order.
export const shown = (node: unknown): string => {
  if (typeof node === 'string') {
    return node
  }
  const element = node as Exclude<Drawn, string> & { props?: { label?: unknown; source?: unknown; text?: unknown } }
  if (element.type === 'Button' && typeof element.props?.label === 'string' && !element.children?.length) {
    return element.props.label
  }
  if (element.type === 'Markdown' && typeof element.props?.text === 'string') {
    return element.props.text
  }
  return (element.children ?? (element as { props?: { children?: unknown[] } }).props?.children ?? []).map(shown).join('')
}
