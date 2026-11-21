Write a memory file and its MEMORY.md line

1. Check first: `await scripts.run("find", { subject, scope: "memory" })`. If a memory covers it,
   read it and `rules.edit` it; one fact per file.
2. Pick the type: `user` (who the user is and how they work), `feedback` (a correction or a preference
   they gave), `project` (a decision or state of work not in the code), `reference` (where something
   lives). A fact the code or git history already shows is not a memory.
3. Write the body as one fact. A `feedback` or `project` body carries two lines: `**Why:**` (the
   reason, with the date and their words if they said them) and `**How to apply:**` (when it applies).
   Put no secret, token or key in it. Convert relative dates to absolute ones.
4. Call `await rules.remember({ file: "feedback_short_name.md", name: "Short title", description:
   "one line saying when to use it", type, body, hook: "the index line's text, under 140 characters" })`.
   Add `folder` to name the project; without it the caller's project is used. It writes the file
   with front matter (name, description, metadata.type) and appends `- [name](file): hook` to
   MEMORY.md, and refuses when the index would pass 200 lines or 25 KB. If it does, merge or drop
   old entries first (`skills.read("consolidate")`).
5. Look at `similarExisting` in the result. If one covers the same fact, `rules.forget` the new
   one or edit the old one.
6. Answer with the file path, the index line written, and the similar memories seen.
