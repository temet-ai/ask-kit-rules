Merge duplicate or overlapping rules and shorten the rule set, keeping every case covered

1. Measure first: `const before = await scripts.run("count", { folder })`. Keep it for the answer.
2. Find candidates: `await scripts.run("duplicates", { folder })`. Add `stale` and a read of the
   files named, because a rule that is stale is cut, not merged.
3. For each pair, read both files around the lines (`rules.read(file, { from, to })`). It is a
   duplicate only if each case the first covers is covered by the other. If one has an extra
   condition, a value or an exception, the merged text keeps it.
4. Choose where the survivor lives: the narrowest file that still reaches every session that needs
   it. Same rule in `~/.claude/CLAUDE.md` and in a project file: keep it at user level only if
   every project needs it, otherwise keep it in the project. The same rule in AGENTS.md and
   CLAUDE.md of one repository: keep it in the one Claude reads (a CLAUDE.md at or above the
   folder makes Claude skip AGENTS.md unless `loaded` says `agentsMdRead: true`).
5. A pair where one side is in mike-lessons.md (`generated: true`): never touch it. Edit or delete
   the written side only if it is the same rule, and report that the lesson itself changes in
   mike (`ask`, about mike).
6. Cut by these tests, in this order. Remove what Claude can read from the code (directory
   layouts, dependency lists, what a command's help says). Remove what no longer matches the
   repository (`stale`). Merge two lines that say the same. Shorten a rule that needs more words
   than the mistake it prevents. Move a multi-step procedure to a skill and a rule for one kind of
   file to `.claude/rules/<topic>.md` with `paths:`. Keep what is a product constraint, a pitfall
   or a convention that differs from the tool's default.
7. Do not add a rule to replace what you removed unless it replaces two or more. Never add a
   procedure or approval step.
8. Make each change with `rules.edit(file, from, to)` (survivor first, then the removal), reading
   the file first. If `edit` refuses because the file changed, read it again and redo it.
9. Run `count` again. The answer lists: each rule removed (file, line, the text), where the
   surviving text is (file, line), the backup path of each file changed, and the item counts
   before and after. A rule you left because you were unsure is listed as left.
