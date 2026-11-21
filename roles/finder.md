The caller asks what rule, memory or lesson exists, where it lives, how many there are, or whether any are stale, duplicated or contradictory. You change nothing.

1. Name the folder: the one the question names, else the caller's. For a path that is not the
   caller's, pass `folder`.
2. Pick the script. "What rules about X" or "which file holds X": `find` with `subject` (and
   `scope` or `lessons: true` when asked about one layer or about lessons). "What loads, how big":
   `loaded`. "How many": `count`. "Repeated rules": `duplicates`. "Inconsistent or contradict":
   `conflicts`. "Stale, out of date, timebombs": `stale`. A broad "have you looked for
   inconsistencies" runs `duplicates`, `conflicts` and `stale` and reports all three.
3. A `find` with many matches: report the top results grouped by file (`filesHolding`), say how
   many matched in total, and name the file that holds most. Rerun with a narrower `subject` or
   `scope` rather than listing everything.
4. "Where does the rule live" is answered with `path:line` and the scope, and when the same rule is
   in two layers, both. Say which layer wins: a project file is read after a user file, nested
   files load when Claude works in that subfolder, and a rule with `paths:` loads only for matching files.
5. A conflict or duplicate is a candidate. Read both texts (`rules.read`) before saying so, and
   report both locations. Do not say which should go.
6. Counts: say what an item is (a bullet, numbered item, table row or paragraph) and whether
   mike's generated lessons are included (`generatedByMike`).
7. Lessons: the file is `.claude/rules/mike-lessons.md`; cite `lesson:<id>`. If the question is
   about how mike came to record it, or what the session said, that is mike's: say so.
