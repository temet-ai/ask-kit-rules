# ask-kit-rules

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about the standing instructions Claude Code sessions work under (CLAUDE.md,
AGENTS.md, rules folders, auto-memory, mike's generated lessons), and tidy them when asked. A
cheap model reads the files outside your agent's context and answers with `path:line` and the
scope each rule lives in.

Questions from its bench, of the kinds agents had answered by hand with `rg` over these files:

- What lesson did mike record about tests that sleep for a fixed time?
- Get me all the rules for how we run and deploy this project: which files hold them?
- Which memory files are missing a Why or How to apply line?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up) and `rg` (ripgrep).

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-rules
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-rules        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-rules --yes  # installs and enables it
```

Restart your agents so `ask` lists `rules`. The kit answers for the folder your agent works in; a
question that names another folder is answered for that one. The setting `REMOTE_WORDS` lists the
words (host names, nicknames) that mark a rule as being about another machine; the default is
`ssh,remote,server,vps`.

## What it carries

| | |
|---|---|
| Scripts | `loaded` (every instruction file that loads for a folder, in load order, with scope, lines, tokens and items), `find` (rules, memories and lessons about a subject, with `path:line`), `count` (items per file and scope, written by hand or generated), `duplicates` (rules repeated across files), `conflicts` (candidate contradictions), `stale` (rules naming a missing path, command, skill, link or past date; memory-index problems) |
| Skills | `consolidate`, `retire-stale`, `resolve-conflict`, `write-rule`, `write-memory`: playbooks the investigator loads when the job calls for one |
| Roles | `finder` for what rule exists and where; `consolidator` for merging, shortening, moving, deleting and writing |

Each script also runs with no model: `ask-kit run rules loaded`, or `ask(do: "rules.loaded")` from
an agent. What loads follows Claude Code's documented rules: `CLAUDE.md` and `CLAUDE.local.md`
from the folder and every parent, `AGENTS.md` only when no CLAUDE.md exists at or above (or when
the Project instructions setting reads both), `.claude/rules` with `paths:` frontmatter loading on
demand, subfolder files loading when Claude works there, and the first 200 lines or 25 KB of
MEMORY.md.

## What it can change

A question never changes anything. When the request asks for a change, it edits, writes and
deletes instruction files, and writes or removes memories with their MEMORY.md line.
`rules.mjs` holds every change back unless the caller asked for one (`act`), and also:

- Reads and writes only instruction files: CLAUDE.md, AGENTS.md, CLAUDE.local.md,
  `.claude/rules/*.md` and files in a memory folder. Credentials, `~/.claude.json`, session
  transcripts and the rest of `~/.claude/projects` are refused. Text that looks like a key or
  token is masked before it reaches the model.
- Never changes `mike-lessons.md`, which mike generates; a lesson is changed in mike.
- Needs the file read first in the same ask, and refuses when it changed since (other sessions
  edit these files).
- Copies each file it changes or deletes to `<ask-kit state>/rules-backups/` and reports the
  removed text, the added text and the backup path.

Its instructions tell it never to delete a rule because of a contradiction alone, and never on a
low-confidence stale finding.

## How well it works

`bench/questions.json` holds six questions and two script runs, each with patterns its answer
must hold. It has not been run on a model yet; `ask-kit kit test rules` runs it.
