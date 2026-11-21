export const meta = {
  purpose:
    "Which rules, memories and lessons are about a subject, across every layer that loads for a folder (user, parent and project files, rules folders, nested files, the memory folder, mike's lessons file), ranked, each with path:line, scope and its heading, and which files hold them. Use it for 'what rules exist about X' and 'which file holds the rule'.",
  params: {
    subject: "plain words, e.g. 'run test deploy'; any word matches, more matched words rank higher",
    folder: "the folder to resolve the layers for, optional (default: the caller's folder)",
    all: "require every word to match, default false",
    pattern: "a regex on the item text instead of words, optional",
    scope: "only one scope: user, project, parent, nested, memory, generated, local, managed",
    lessons: "only lessons from mike's generated lessons file, default false",
    max: "default 25",
  },
  returns: "{subject, terms, searched:{files,items}, matches, shown, results:[{at:'path:line', scope, heading, text, score, matched, lesson?, generated?}], filesHolding:[{path, matches}]}",
  example: 'await scripts.run("find", { subject: "deploy push test build", max: 15 })',
};

export default async function ({ rules }, { subject = "", folder, all = false, pattern, scope, lessons = false, max = 25 } = {}) {
  if (!subject && !pattern) throw new Error("give subject (words) or pattern (a regex)");
  return rules.find(subject, { folder, all, pattern, scope, lessons, max });
}
