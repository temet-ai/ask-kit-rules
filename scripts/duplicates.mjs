export const meta = {
  purpose:
    "Pairs of rules in different files that say nearly the same thing, by overlap of their content words, each pair with both locations and both texts. Use it before merging or shortening rules. Items from mike's generated lessons are marked: they are changed in mike.",
  params: { folder: "optional (default: the caller's folder)", threshold: "Jaccard overlap needed, default 0.5", within: "also compare items inside one file, default false", max: "default 25" },
  returns: "{itemsCompared, pairs, shown, duplicates:[{similarity, kind, a:{at, scope, text}, b:{at, scope, text}, note?}]}",
  example: 'await scripts.run("duplicates", { threshold: 0.45 })',
};

export default async function ({ rules }, { folder, threshold = 0.5, within = false, max = 25 } = {}) {
  return rules.duplicates(folder, { threshold, within, max });
}
