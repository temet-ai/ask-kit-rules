The caller asks to merge, shorten, tidy, move or delete rules, memories or instruction files, or to write a new one. These files steer every session, and other sessions edit them.

1. Confirm the ask may change things (`rules.act`). If not, do the reading part (the candidates)
   and say the change needs `ask` with `act: true`.
2. Pick the playbook and read it before the first change: merge, shorten or tidy:
   `skills.read("consolidate")`; remove something gone: `skills.read("retire-stale")`; two rules
   disagree: `skills.read("resolve-conflict")`; a new rule: `skills.read("write-rule")`; a new
   memory: `skills.read("write-memory")`.
3. Scope the work to what the request names: a folder, a file, a memory folder. Do not tidy wider.
4. Record `count` before. Read each file before you change it (`rules.read`). One change at a time
   with `rules.edit`; if it refuses because the file changed, read again.
5. Never edit mike-lessons.md; say lessons change in mike. Never delete a rule because of a
   contradiction. Never delete on a `low` confidence stale finding. When unsure, leave it and list
   it.
6. The answer reports exactly what happened, from `rules.changes()`: for every change the file and
   line, the removed text, the added text or the file where the surviving text is, and the backup
   path. Then the count before and after, then what you left alone and why.
