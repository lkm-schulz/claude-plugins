# claude-plugins

Claude Code plugins.

## Install

```
claude plugin marketplace add lkm-schulz/claude-plugins
claude plugin install codex-style@lkm-schulz-plugins
```

Then run `/reload-plugins` in any open session.

## Mods

### codex-style

Draws transcript in a more concise style inspired by Codex.

- Tool calls: one dim row per call, such as `• Read src/parser.rs :15-22`, `• Ran make docs` or `• Edited src/parser.rs ▸ +3 -1`. A failed call's bullet is red.
- Groups of reads and searches: one row, `• Explored parser.rs, lexer.rs · 2 searches ▸`.
- Consecutive edits: one row, `• Edited a.md, b.md ▸ 3 edits +8 -2`.
- Folds: pressing `▸` shows an edit's diff, or a command's output and the files the command changed.
- Prompts: `› fix the failing parser test` on a shaded band across the line.
- Replies: a `•` before each reply. The `replyStyle` setting `bar` draws a muted bar down each reply's left edge instead.
- Thinking summaries: faint, after a `∴`.
- Spinner: `✻ Working… (12s)` in place of the sampled word.
- Turn end: `─ Worked for 42s ───` across the line.

The ctrl+o transcript keeps Claude Code's own drawing.
