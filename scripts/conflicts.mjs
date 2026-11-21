export const meta = {
  purpose:
    "Candidate contradictions: two rules about the same subject where one says always or must and the other never or don't, or that give different numbers for the same thing. Candidates only, from wording; read both sides and decide. A contradiction is reported to the owner, never settled by deleting a rule.",
  params: { folder: "optional (default: the caller's folder)", minOverlap: "shared-word overlap needed, default 0.15", max: "default 25" },
  returns: "{itemsCompared, candidates, shown, conflicts:[{kind:'opposite wording'|'different numbers', overlap, shared, values?, a:{at, scope, text, says?}, b:{...}}]}",
  example: 'await scripts.run("conflicts")',
};

export default async function ({ rules }, { folder, minOverlap = 0.15, max = 25 } = {}) {
  return rules.conflicts(folder, { minOverlap, max });
}
