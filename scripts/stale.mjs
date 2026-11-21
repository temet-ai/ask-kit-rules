export const meta = {
  purpose:
    "Rules that may be out of date: a backticked path that does not exist, a command run by a rule that is not on PATH, a skill or agent that is not installed, a broken memory or Markdown link, a date that has passed, wording like 'for now' or 'temporary'; and memory-folder problems (an index line pointing at a missing file, a file missing from MEMORY.md, missing front matter, no Why or How to apply, a project memory not touched for 30 days, an index over 200 lines or 25 KB). Each finding has path:line, what it names and a confidence.",
  params: { folder: "optional (default: the caller's folder)", max: "findings listed, default 40" },
  returns: "{checked, findings, byKind, shown, stale:[{kind, at, scope, ref, why, confidence, text}], memoryIssues:[{at, issue}]}",
  example: 'await scripts.run("stale", { folder: "/path/to/projects" })',
};

export default async function ({ rules }, { folder, max = 40 } = {}) {
  return rules.stale(folder, { max });
}
