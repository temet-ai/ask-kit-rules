Write a new rule in the right file and form

1. Check it is needed. `await scripts.run("find", { subject })`: if a rule covers it, edit that
   one instead of adding a second. A new rule is for a mistake that happened twice, a correction
   typed again, or a fact every session needs. Prefer a rule that replaces two.
2. Pick the layer:
   - every project, only this user: `~/.claude/CLAUDE.md` (short) or `~/.claude/rules/<topic>.md`;
     give it `paths:` frontmatter when it matters only for some files;
   - one repository, for everyone: its CLAUDE.md, or AGENTS.md when the repository has no
     CLAUDE.md; a rule for one kind of file or one folder goes in `.claude/rules/<topic>.md` with
     `paths:`;
   - one repository, only this user, not committed: CLAUDE.local.md;
   - something learned from a session (a preference, a decision, a fact about the project): a
     memory (`skills.read("write-memory")`);
   - a multi-step procedure: a skill, which is the skills kit's job;
   - something that must be enforced rather than asked: a Claude Code hook; say that it needs one
     and do not write the hook yourself.
   - a lesson: mike records those (`ask` about mike). Never write mike-lessons.md.
3. Write it concrete enough to check: "Run `cargo nextest run` before committing", not "test your
   changes". One instruction per bullet. Name the real path or command. No rule that restates
   what the code or a tool's help already says. Keep the file under 200 lines.
4. Add it with `rules.edit` (insert after a line you read) or, for a new topic file,
   `rules.write("<dir>/.claude/rules/<topic>.md", text)`. One topic per file, a descriptive name.
5. Check: `find` the subject again to see it appears once, and `loaded` for the file's size.
6. Answer with the file and line, the text written, and why that layer.
