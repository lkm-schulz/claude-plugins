// The project root when the session started; null until it is recorded.
export type StartRoot = string | null

// Whether a fold (a Bash call's output, an Edit's diff, a group's calls) is open.
export type IsOpen = boolean

// A run of edits straight after one another: each call's file, and once done,
// whether it created the file and the lines it added and removed.
export type EditRun = {
  calls: { id: string; path: string; isCreated: boolean; isDone: boolean; counts?: { added: number; removed: number } }[]
} | null

declare module 'claude-code' {
  interface PluginState {
    'codex-style': {
      startRoot: StartRoot
      // One per Bash call, by its tool_use_id.
      isOutputOpen: StateFamily<IsOpen>
      // One per Edit or Write call, by its tool_use_id.
      isDiffOpen: StateFamily<IsOpen>
      // One per tool group, by its first call's tool_use_id.
      isGroupOpen: StateFamily<IsOpen>
      // One per Edit or Write call, by its tool_use_id: its run's first call.
      editRunOf: StateFamily<string | null>
      // One per run of edits, by its first call's tool_use_id.
      editRun: StateFamily<EditRun>
      isRunOpen: StateFamily<IsOpen>
    }
  }
}
