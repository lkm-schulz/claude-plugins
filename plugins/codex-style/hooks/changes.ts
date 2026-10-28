// The +/- counts of a file change and the shapes of a Bash call's output.

type Patch = { lines: string[] }[]
type FileChange = {
  type?: 'create' | 'update'
  content?: string
  structuredPatch: Patch
  gitDiff?: { additions: number; deletions: number }
  staged?: boolean
}

export type Counts = { added: number; removed: number }

// The lines a change added and removed, as `git diff --stat` counts them; a
// new file counts every line it was written with. A change whose patch is
// empty (its diff took too long, or the file was too large) counts from its
// git diff where it has one.
export const changeCounts = (output: FileChange): Counts => {
  if (output.type === 'create') {
    return { added: output.content ? output.content.replace(/\n$/, '').split('\n').length : 0, removed: 0 }
  }
  if (output.structuredPatch.length === 0 && output.gitDiff) {
    return { added: output.gitDiff.additions, removed: output.gitDiff.deletions }
  }

  const changed = output.structuredPatch.flatMap(hunk => hunk.lines)
  return {
    added: changed.filter(line => line.startsWith('+')).length,
    removed: changed.filter(line => line.startsWith('-')).length,
  }
}

// The counts of a finished, successful Edit or Write; undefined for any other
// result, and for one held for review instead of written, which the engine
// then draws as usual.
export const countsOf = (isErrored: boolean, output: unknown) => {
  const change = output as FileChange | undefined
  if (isErrored || !change || !Array.isArray(change.structuredPatch) || change.staged) {
    return undefined
  }

  const counts = changeCounts(change)
  return counts.added === 0 && counts.removed === 0 ? undefined : counts
}

// Whether an Edit or Write created its file.
export const isCreated = (input: { old_string?: unknown }, output: unknown) =>
  input.old_string === '' || (output as { type?: unknown } | undefined)?.type === 'create'

// `+3 -1`, a side left out when it is zero.
export const countSides = (counts: Counts) =>
  [
    { text: `+${counts.added}`, color: 'success' as const, isShown: counts.added > 0 },
    { text: `-${counts.removed}`, color: 'error' as const, isShown: counts.removed > 0 },
  ].filter(side => side.isShown)

// Whether a Bash output is a finished command's lines, or the text a failed
// call read. Not an interrupted command's, a backgrounded one's, an image, or
// one whose full output was saved to a file: the engine marks each of those.
export const isPlain = (output: unknown) => {
  if (typeof output === 'string') {
    return true
  }
  if (typeof output !== 'object' || output === null) {
    return false
  }
  const result = output as { interrupted?: unknown; isImage?: unknown; backgroundTaskId?: unknown; persistedOutputPath?: unknown }
  return (
    result.interrupted !== true &&
    !result.isImage &&
    result.backgroundTaskId === undefined &&
    result.persistedOutputPath === undefined
  )
}

type EditDiff = {
  files: { filePath: string; hunks?: { lines?: string[] }[]; created?: true; deleted?: true }[]
  moreFiles?: number
}

export type ChangedFile = { path: string; change: 'Created' | 'Deleted' | 'Updated' } & Counts

// The files a Bash command created, deleted or updated, with the lines added
// and removed, in its diff's order, and how many more the diff left uncounted.
export const changedFilesOf = (output: unknown): { files: ChangedFile[]; moreFiles: number } => {
  const diff = (output as { bashEditDiff?: EditDiff } | null)?.bashEditDiff
  if (typeof output !== 'object' || output === null || !Array.isArray(diff?.files)) {
    return { files: [], moreFiles: 0 }
  }
  return {
    files: diff.files.map(file => {
      const changed = (file.hunks ?? []).flatMap(hunk => hunk.lines ?? [])
      return {
        path: file.filePath,
        change: file.created === true ? 'Created' : file.deleted === true ? 'Deleted' : 'Updated',
        added: changed.filter(line => line.startsWith('+')).length,
        removed: changed.filter(line => line.startsWith('-')).length,
      }
    }),
    moreFiles: diff.moreFiles ?? 0,
  }
}
