Two rules that may contradict each other: report them, never pick a side

1. Take a pair from `await scripts.run("conflicts", { folder })`. Read both rules in context. The
   wording match is only a candidate: "always use X" and "never use X for Y" do not conflict.
2. It is a real contradiction only if one session could not follow both at once. Check whether
   their scopes differ (one for a subfolder, one `paths:`-scoped, one for a machine); then both
   stand and you say how they divide.
3. For a real one, find which is newer and who wrote it: `git log -1 --format=%ad -L <line>,<line>:<file>`
   through the git kit (`ask.kit("git", ...)`), or the memory file's `modified` frontmatter. Also
   ask whether the operator already ruled on it (`ask.kit("mike", "what did the user say about <subject>")`):
   a recorded objection outranks a repository rule that contradicts it.
4. Report, do not decide: both locations (`path:line`, scope), both texts, which is newer, what
   the operator said if anything, and the one question that settles it. Ask the caller which
   stays.
5. Only when the caller names which side stays, change the other with `skills.read("consolidate")`'s
   steps. A contradiction alone is never a reason to delete a rule, and a lesson from mike is
   changed in mike.
