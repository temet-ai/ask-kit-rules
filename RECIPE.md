# Recipe: rules kit

## What it answers

The standing instructions a Claude Code session works under: which rules, memories and lessons
exist about a subject and which file holds each; every instruction file that loads for a folder
and how big it is; how many rules there are; which repeat, may contradict or are out of date. It
changes them when asked: merge, shorten, move, delete, write a rule or a memory.

## What it needs

- `rg` (ripgrep) on PATH, for finding CLAUDE.md, AGENTS.md and rules files in subfolders.
- Nothing else: no keys, no build step.

## What it reads and runs

- Reads CLAUDE.md, AGENTS.md, CLAUDE.local.md, `.claude/rules/**/*.md` in the folder, its parents
  and its subfolders; `~/.claude/CLAUDE.md` and `~/.claude/rules`; `~/.claude/projects/<slug>/memory/`;
  and `pluginConfigs` in `~/.claude/settings.json` for the Project instructions setting (no other key).
  It refuses every other path, including `~/.claude/.credentials.json`, `~/.claude.json` and `*.jsonl`.
- Runs `git rev-parse` (to find the repository and its main checkout, which name the memory
  folder) and `rg --files`. No shell.
- Changes only with `act`: `rules.edit`, `write`, `remove`, `remember`, `forget`. Each needs the
  file read first and unchanged since, refuses mike-lessons.md, and copies the old file to the
  state folder first.

## Rebuild it from an empty folder

Write `ask-kit.toml` with one `module` source named `rules`, `acts` written as
`rules.<function>`, and two roles. The module exports `make({settings, push, cwd, act})`
returning:

- `loaded(folder)`: folders from the filesystem root to the folder; per folder CLAUDE.md,
  .claude/CLAUDE.md, .claude/rules/** (a `paths:` list in the front matter means on-demand),
  AGENTS.md only when no CLAUDE.md or CLAUDE.local.md exists at or above (or the setting reads
  both), CLAUDE.local.md; `@path` imports after their importer; the memory folder
  `~/.claude/projects/<path with every non-alphanumeric replaced by ->/memory`, taken from the git
  root or main checkout; files in subfolders found with `rg --files`. Each file: scope, loads,
  lines, bytes, tokens (bytes/4), items.
- Items: a bullet, numbered item, table row or paragraph with its heading path; one line per
  `[lesson:<id> rev:<n>]` in mike-lessons.md.
- `find` (stemmed word match weighted by rarity), `count`, `duplicates` (Jaccard of content words),
  `conflicts` (always/must against never/don't on shared words, or differing numbers), `stale`
  (backticked paths, commands after run/call/invoke, skills, agents, links, past dates; memory index
  checks), `read`, `edit`, `write`, `remove`, `remember`, `forget`, `changes`.

Scripts `loaded`, `find`, `count`, `duplicates`, `conflicts`, `stale` call these. Skills:
consolidate, retire-stale, resolve-conflict, write-rule, write-memory. Roles: finder, consolidator.
`instructions.md`: start from a script, name the folder, never change mike-lessons.md, never
delete on a contradiction, report each change with its backup.

## Bench

`bench/questions.json`: questions of the kinds agents answer by hand with reads and greps of
instruction files, put to the folder `bench/fixture/ankh-api`, and two script runs.
