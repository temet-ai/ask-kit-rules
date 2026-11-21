Retire a rule that names something that no longer exists

1. Run `await scripts.run("stale", { folder })` and take one finding. Read the rule in context
   (`rules.read(file, { from: line - 3, to: line + 8 })`).
2. Prove it is gone. A `missing path`: look for the file under another name or place
   (`ask.kit("code", "where is <name> now?")` finds where it moved). A `missing command`: it may be an alias, a shell function or on
   another machine. A `missing skill` or `missing agent`: a plugin may supply it. A `date in the
   past`: the rule may still hold after its date. Confidence `low` is never enough to delete.
3. Decide, and say which:
   - the thing moved or was renamed: update the path in the rule (`rules.edit`), keep the rule;
   - the rule still holds without the reference: remove only the dead reference;
   - the whole rule is about something that is gone: delete the rule;
   - you cannot tell: leave it and list it as "needs the owner".
4. A memory file about something gone: `rules.forget(file)` removes the file and its MEMORY.md
   line together. A project memory is checked against the repository first, because project facts
   go stale fast.
5. A stale lesson in mike-lessons.md is not edited. Report its lesson id and say the change goes
   through mike.
6. Answer with each rule you changed or removed (file, line, old text, new text or "deleted",
   backup path), each you left and why, and the item counts before and after.
