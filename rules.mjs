// A client for the standing instructions a Claude Code session works under: CLAUDE.md, AGENTS.md,
// CLAUDE.local.md, rules folders, auto-memory folders and the lessons file mike generates.
//
// It resolves which files load for a folder, splits each into rule items with path:line, and
// answers questions across all of them: where a rule is, what is duplicated, what may contradict,
// what names something that no longer exists. When the caller asked for a change (`act`) it also
// edits, writes, removes and writes memories.
//
// Three checks. A change needs `act`. Only instruction files can be read or written (never
// credentials, ~/.claude.json, transcripts or any other part of ~/.claude/projects than a memory
// folder). The lessons file mike generates is never written. Text that looks like a secret is
// masked, because what the investigator reads goes to a cloud model.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};
const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};

const LAUNCH_LINES = 200; // MEMORY.md: first 200 lines or 25 KB load at launch
const LAUNCH_BYTES = 25_000;
const ONDEMAND_CHARS = 40_000; // on-demand files over this (200K window) are cut
const MD_NAMES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const AGENT_NAMES = ["AGENTS.md", ".claude/AGENTS.md"];

const STOP = new Set(
  "a an the and or but if then of to in on at by for with from as is are was were be been being it its this that these those you your we our i me my they them their he she not no do does did done can could will would should shall may might must have has had having so than too very just also into onto about over under up down out off per via etc don t s ll re ve never always what which who when where how why all any get got want need rule rules file files there here".split(" "),
);
const NEG = /\b(never|don'?t|do not|must not|mustn'?t|should not|shouldn'?t|cannot|can'?t|avoid|no longer|stop|forbidden|prohibited|not allowed)\b/i;
const POS = /\b(always|must|required|requires?|ensure|make sure|prefer|should)\b/i;
const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{20,}\.[\w-]{10,}\.[\w-]+)/g;
const SECRET_KV = /\b((?:pass(?:word|wd)?|secret|token|api[_-]?key|auth)\w*\s*[:=]\s*)(?!\*)["']?[^\s"',;]{6,}/gi;
const mask = (s) => String(s ?? "").replace(SECRET, "***").replace(SECRET_KV, "$1***");

const clip = (s, n = 300) => (s == null ? s : s.length > n ? s.slice(0, n - 1) + "…" : s);
const slugOf = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 || /\d/.test(w));
const content = (s) => new Set(words(s).filter((w) => !STOP.has(w)).map(stem));

function execP(cmd, args, { cwd, timeout = 15_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 32 << 20, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout || "", err: stderr || "" });
    });
  });
}

/** Front matter at the top of a file: returns the flat keys we care about and where the body starts. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: null, bodyLine: 1 };
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  let listKey = null;
  for (const l of lines) {
    const li = l.match(/^\s+-\s+(.*)$/);
    if (li && listKey) {
      (fm[listKey] ||= []).push(li[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    const kv = l.match(/^\s*([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      listKey = kv[2] === "" ? kv[1] : null;
      if (kv[2] !== "") fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  return { fm, bodyLine: m[0].split(/\r?\n/).length };
}

/** Split Markdown into rule items: a bullet, a numbered item, a table row or a paragraph, with its heading path. */
function splitItems(text, startLine = 1) {
  const lines = text.split(/\r?\n/);
  const items = [];
  const heads = [];
  let cur = null;
  let fence = null;
  let comment = false;
  const flush = () => {
    if (cur) {
      cur.text = cur.parts.join(" ").replace(/\s+/g, " ").trim();
      delete cur.parts;
      if (cur.text) items.push(cur);
      cur = null;
    }
  };
  const start = (i, kind, t, indent = 0) => {
    flush();
    cur = { line: i + 1, endLine: i + 1, kind, heading: heads.filter(Boolean).join(" > "), indent, parts: [t] };
  };
  for (let i = startLine - 1; i < lines.length; i++) {
    const l = lines[i];
    if (fence) {
      cur.parts.push(l.trim());
      cur.endLine = i + 1;
      if (new RegExp("^\\s*" + fence).test(l)) {
        fence = null;
        flush();
      }
      continue;
    }
    if (comment) {
      if (l.includes("-->")) comment = false;
      continue;
    }
    if (/^\s*<!--/.test(l)) {
      if (!l.includes("-->")) comment = true;
      continue;
    }
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) {
      start(i, "code", l.trim());
      fence = f[1].slice(0, 3);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (h) {
      flush();
      heads.length = h[1].length - 1;
      heads[h[1].length - 1] = h[2];
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(l)) {
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(l)) continue; // separator
      const nxt = lines[i + 1] || "";
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(nxt) && /-/.test(nxt)) {
        flush();
        continue; // header row
      }
      start(i, "row", l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" | "));
      continue;
    }
    const b = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (b) {
      start(i, /\d/.test(b[2]) ? "number" : "bullet", b[3], b[1].length);
      continue;
    }
    if (cur && cur.kind !== "row" && cur.kind !== "code" && !/^\[lesson:\d+ /.test(l)) {
      cur.parts.push(l.trim());
      cur.endLine = i + 1;
    } else start(i, "para", l.trim());
  }
  flush();
  return items;
}

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

export function make({ settings, push, cwd, act }) {
  const remoteWords = String(settings?.REMOTE_WORDS || "ssh,remote,server,vps").split(",").map((w) => w.trim()).filter(Boolean);
  return makeRules({ cwd: cwd || process.cwd(), push, act: !!act, remoteWords });
}

export function makeRules({ cwd, push = () => {}, act = false, home = os.homedir(), stateDir, remoteWords = ["ssh", "remote", "server", "vps"] } = {}) {
  const claudeDir = path.join(home, ".claude");
  const projectsDir = path.join(claudeDir, "projects");
  const state = stateDir || path.join(process.env.ASK_KIT_STATE || (process.env.XDG_STATE_HOME ? path.join(process.env.XDG_STATE_HOME, "ask-kit") : path.join(home, ".local", "state", "ask-kit")), "rules-backups");
  const expand = (p) => (p === "~" ? home : String(p).startsWith("~/") ? path.join(home, String(p).slice(2)) : String(p));
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const underProjects = (abs) => abs.startsWith(projectsDir + path.sep);
  const memoryFileRe = new RegExp("^" + projectsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/[^/]+/memory/.+\\.md$");

  /** Only instruction and memory files can be read or written. */
  function isInstructionPath(abs) {
    const b = path.basename(abs);
    if (/\.jsonl$/.test(b) || b === ".credentials.json" || b === ".claude.json" || b.startsWith(".env")) return false;
    if (underProjects(abs)) return memoryFileRe.test(abs);
    if (["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"].includes(b)) return true;
    return /\/\.claude\/(rules\/.+|CLAUDE|AGENTS)\.md$/.test(abs) && !/\.\./.test(abs);
  }
  const guardRead = (p) => {
    const abs = path.resolve(expand(p));
    if (!isInstructionPath(abs)) deny(`${abs} is not an instruction or memory file (CLAUDE.md, AGENTS.md, CLAUDE.local.md, .claude/rules/*.md, or a file in a memory folder)`);
    if (!isInstructionPath(real(abs)) && !/\/\.claude\/rules\//.test(abs)) {
      // a symlink to somewhere that is not an instruction file
      const r = real(abs);
      if (/credential|\.env|\.jsonl$|\.claude\.json$/.test(r)) deny("that link points at a credentials or transcript file");
    }
    return abs;
  };

  const cache = new Map(); // path -> {sig, text, ...}
  const seen = new Map(); // path -> sig at the time this ask read it
  const statSig = (p) => {
    const s = fs.statSync(p);
    return `${s.mtimeMs}:${s.size}`;
  };
  function readFile(abs) {
    const sig = statSig(abs);
    const c = cache.get(abs);
    if (c && c.sig === sig) return c;
    const raw = fs.readFileSync(abs, "utf8");
    const { fm, bodyLine } = frontmatter(raw);
    const text = mask(raw);
    const rec = {
      sig,
      raw: text,
      bytes: Buffer.byteLength(raw),
      lines: raw === "" ? 0 : raw.split("\n").length - (raw.endsWith("\n") ? 1 : 0),
      fm,
      bodyLine,
      generated: path.basename(abs) === "mike-lessons.md" || /mike-learning-generated/.test(raw.slice(0, 400)),
      hash: sha(raw),
      mtime: fs.statSync(abs).mtime.toISOString(),
    };
    cache.set(abs, rec);
    return rec;
  }
  function itemsOf(abs, meta = {}) {
    const rec = readFile(abs);
    if (rec.items) return rec.items;
    rec.items = splitItems(rec.raw, rec.bodyLine).map((it) => {
      const lesson = rec.generated && it.text.match(/^\[lesson:(\d+) rev:(\d+)\]\s*(?:\[(\w+)\])?/);
      return { path: abs, ...it, ...(lesson ? { lesson: { id: +lesson[1], rev: +lesson[2], tag: lesson[3] || null } } : {}) };
    });
    return rec.items;
  }

  // ---- which files load -------------------------------------------------------------------------
  async function gitInfo(dir) {
    const top = await execP("git", ["rev-parse", "--show-toplevel"], { cwd: dir, timeout: 5000 });
    if (top.code !== 0) return { root: null, main: null };
    const root = top.out.trim();
    const common = await execP("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, timeout: 5000 });
    let main = root;
    if (common.code === 0 && /\/\.git$/.test(common.out.trim())) main = common.out.trim().replace(/\/\.git$/, "");
    return { root, main };
  }

  function agentsMode() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.json"), "utf8")); // only this key is used
      const pc = j?.pluginConfigs || {};
      const v = (pc["cc-plugin-agents-md@builtin"] || pc["agents-md@builtin"])?.options?.instructionFiles;
      if (typeof v === "string") return v;
    } catch {}
    return "claude-md-or-agents-md";
  }

  function walkMd(dir, depth = 0, out = []) {
    if (depth > 6 || !isDir(dir)) return out;
    let ents = [];
    try {
      ents = fs.readdirSync(dir).sort();
    } catch {
      return out;
    }
    for (const e of ents) {
      const p = path.join(dir, e);
      if (isDir(p)) walkMd(p, depth + 1, out);
      else if (e.endsWith(".md") && isFile(p)) out.push(p);
    }
    return out;
  }

  function importsOf(abs, depth = 0, acc = new Set()) {
    if (depth > 4) return acc;
    let txt;
    try {
      txt = readFile(abs).raw;
    } catch {
      return acc;
    }
    let inCode = false;
    for (const l of txt.split("\n")) {
      if (/^\s*(```|~~~)/.test(l)) inCode = !inCode;
      if (inCode) continue;
      for (const m of l.matchAll(/(?:^|[\s(])@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+\.[A-Za-z]{1,6})\b/g)) {
        const t = m[1].startsWith("~/") ? path.join(home, m[1].slice(2)) : path.resolve(path.dirname(abs), m[1]);
        if (isFile(t) && !acc.has(real(t))) {
          acc.add(real(t));
          importsOf(t, depth + 1, acc);
        }
      }
    }
    return acc;
  }

  const describe = (abs, o) => {
    const rec = readFile(abs);
    const items = o.light ? null : itemsOf(abs).filter((i) => i.kind !== "code").length;
    const f = {
      path: abs,
      scope: o.scope,
      loads: o.loads,
      lines: rec.lines,
      bytes: rec.bytes,
      tokens: Math.ceil(rec.bytes / 4),
      items,
    };
    if (rec.generated) f.generated = true;
    if (rec.fm?.paths) f.paths = rec.fm.paths;
    if (o.note) f.note = o.note;
    if (o.repo) f.repo = o.repo;
    if (o.imports) f.importedBy = o.imports;
    return f;
  };

  // Folders whose instruction files no session loads: build output, vendored code, backups and artifacts, plugin caches, test fixtures.
  const SKIP_SEG = /^(node_modules|target|dist|build|out|vendor|vendored|third_party|third-party|\.next|\.svelte-kit|\.cache|artifacts|fixtures?|__fixtures__|testdata|golden|snapshots|__snapshots__|worktrees)$|backup|-artifacts$/i;
  const skipPath = (rel) => {
    const segs = rel.split("/");
    if (segs.slice(0, -1).some((x) => SKIP_SEG.test(x))) return true;
    return /(^|\/)\.claude\/(plugins|skills)\//.test(rel);
  };
  /** CLAUDE.md, AGENTS.md and rules in subfolders, minus worktrees, ignored paths and the folders above. */
  async function nestedFiles(F) {
    const common = ["--hidden", "--max-depth", "7", "-g", "!**/.git/**", "-g", "!**/node_modules/**", "-g", "!**/target/**"];
    const main = await execP("rg", ["--files", ...common, "-g", "CLAUDE.md", "-g", "AGENTS.md", "-g", "**/.claude/rules/**/*.md", F], { timeout: 25_000 });
    // CLAUDE.local.md is usually git-ignored on purpose: look for it without the ignore files
    const local = await execP("rg", ["--files", "--no-ignore", ...common, "-g", "CLAUDE.local.md", F], { timeout: 25_000 });
    const marks = await execP("rg", ["--files", "--no-ignore", ...common, "-g", ".git", F], { timeout: 25_000 }); // a .git that is a file marks a worktree or submodule
    const wt = marks.out.split("\n").filter(Boolean).map((p) => path.dirname(p)).filter((d) => d !== F);
    const out = new Set([...main.out.split("\n"), ...local.out.split("\n")].filter(Boolean));
    return [...out].filter((p) => !skipPath(path.relative(F, p)) && !wt.some((d) => p.startsWith(d + "/"))).sort();
  }
  /** The repository a nested file belongs to, when the folder asked about is not itself inside one. */
  function repoOf(p, F) {
    for (let d = path.dirname(p); d.startsWith(F) && d !== F; d = path.dirname(d)) if (fs.existsSync(path.join(d, ".git"))) return path.relative(F, d);
    return null;
  }

  /** Every instruction file that loads (or may load) for a folder, in load order. */
  async function loaded(folder, o = {}) {
    let F = real(expand(folder || cwd));
    if (isFile(F)) F = path.dirname(F);
    if (!isDir(F)) throw new Error(`no such folder: ${folder}`);
    const git = await gitInfo(F);
    const mode = agentsMode();
    const files = [];
    const have = new Set();
    const notes = [];
    const add = (abs, opts) => {
      const r = real(abs);
      if (have.has(r) || !isFile(abs)) return false;
      have.add(r);
      files.push(describe(abs, { light: opts.light, ...opts }));
      return true;
    };
    const addWithImports = (abs, opts) => {
      if (!add(abs, opts)) return;
      if (opts.loads === "launch") for (const imp of importsOf(abs)) add(imp, { ...opts, note: "imported with @", imports: abs, light: false });
    };

    // managed policy, then user
    addWithImports("/etc/claude-code/CLAUDE.md", { scope: "managed", loads: "launch" });
    addWithImports(path.join(claudeDir, "CLAUDE.md"), { scope: "user", loads: "launch" });
    for (const r of walkMd(path.join(claudeDir, "rules"))) addWithImports(r, { scope: "user", loads: readFile(r).fm?.paths ? "on-demand" : "launch", note: readFile(r).fm?.paths ? "path-scoped: loads when a matching file is opened" : undefined });

    // directories from the filesystem root down to F
    const chain = [];
    for (let d = F; ; d = path.dirname(d)) {
      chain.unshift(d);
      if (d === path.dirname(d)) break;
    }
    let anyClaude = false;
    for (const d of chain) for (const n of MD_NAMES) if (!(d === home && n === ".claude/CLAUDE.md") && isFile(path.join(d, n))) anyClaude = true;
    const agentsLoad = mode === "claude-md-and-agents-md" || (mode === "claude-md-or-agents-md" && !anyClaude);
    if (mode === "managed-only") notes.push("Project instructions is managed-only: user and project files do not load at launch");
    for (const d of chain) {
      const scope = d === F ? "project" : "parent";
      for (const n of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
        if (d === home && n === ".claude/CLAUDE.md") continue;
        addWithImports(path.join(d, n), { scope, loads: "launch" });
      }
      for (const r of walkMd(path.join(d, ".claude", "rules"))) {
        if (d === home && have.has(real(r))) continue;
        const sp = readFile(r).fm?.paths;
        addWithImports(r, { scope, loads: sp ? "on-demand" : "launch", note: sp ? "path-scoped: loads when a matching file is opened" : undefined });
      }
      for (const n of AGENT_NAMES) {
        const p = path.join(d, n);
        if (!isFile(p) || have.has(real(p))) continue;
        if (agentsLoad) addWithImports(p, { scope, loads: "launch", note: mode === "claude-md-and-agents-md" ? "read: Project instructions is claude-md-and-agents-md" : "read because no CLAUDE.md exists at or above" });
        else add(p, { scope, loads: "no", note: mode === "claude-md" ? "not read: Project instructions is claude-md" : "not read: a CLAUDE.md or CLAUDE.local.md exists at or above this folder (Claude Code reads AGENTS.md only when none does)" });
      }
      for (const p of [path.join(d, "CLAUDE.local.md")]) addWithImports(p, { scope, loads: "launch", note: "personal, not committed" });
    }

    // memory
    const cands = [...new Set([git.main, git.root, F].filter(Boolean))];
    let memDir = null;
    for (const c of cands) {
      const m = path.join(projectsDir, slugOf(c), "memory");
      if (isDir(m)) {
        memDir = m;
        break;
      }
    }
    const memory = { dir: memDir, expected: path.join(projectsDir, slugOf(cands[0]), "memory"), exists: !!memDir };
    if (memDir) {
      const idx = path.join(memDir, "MEMORY.md");
      if (isFile(idx)) {
        const f = describe(idx, { scope: "memory", loads: "launch", light: false, note: "index: the first 200 lines or 25 KB load" });
        if (f.lines > LAUNCH_LINES || f.bytes > LAUNCH_BYTES) {
          f.truncated = true;
          f.note = `index over its launch limit (200 lines or 25 KB): the rest is not loaded`;
          f.tokens = Math.ceil(Math.min(f.bytes, LAUNCH_BYTES) / 4);
        }
        have.add(real(idx));
        files.push(f);
      }
      for (const p of walkMd(memDir)) if (path.basename(p) !== "MEMORY.md") add(p, { scope: "memory", loads: "on-demand", note: "topic file: read when needed" });
    } else {
      // memory of an ancestor folder is not loaded for this folder, but say it exists
      const above = chain.slice(0, -1).map((c) => path.join(projectsDir, slugOf(c), "memory")).filter(isDir);
      if (above.length) memory.existsAbove = above;
    }

    // below F: load when Claude works there
    let nestedTotal = 0;
    const nestedCap = o.nestedMax ?? 30;
    if (o.nested !== false) {
      const depth = (p) => path.relative(F, p).split("/").length;
      const found = (await nestedFiles(F)).sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1)).filter((p) => !have.has(real(p)) && !files.some((f) => f.path === p));
      nestedTotal = found.length;
      for (const [i, p] of found.entries()) {
        const rel = path.relative(F, p);
        const b = path.basename(p);
        const isRule = /\.claude\/rules\//.test(p);
        const generated = b === "mike-lessons.md";
        const loadsNested = b === "AGENTS.md" ? (agentsLoad ? "on-demand" : "no") : "on-demand";
        const repo = git.root ? null : repoOf(p, F);
        const where = repo ? `applies to the repository ${repo}, not to ${F}` : null;
        if (i < nestedCap) {
          have.add(real(p));
          files.push(describe(p, { scope: "nested", loads: loadsNested, repo, note: where || isRule ? "rule in a subfolder: loads when Claude works there" : "loads when Claude works in " + path.dirname(rel) }));
        } else files.push({ path: p, scope: "nested", loads: loadsNested, bytes: fs.statSync(p).size, tokens: Math.ceil(fs.statSync(p).size / 4), skipped: true, ...(repo ? { repo } : {}), ...(generated ? { generated: true } : {}) });
      }
    }
    const firstWith = new Map();
    for (const f of files) {
      if (f.skipped) continue;
      const h = readFile(f.path).hash;
      if (firstWith.has(h)) f.sameContentAs = firstWith.get(h);
      else firstWith.set(h, f.path);
    }
    files.forEach((f, i) => (f.order = i + 1));
    // mike's generated lessons keep their own scope
    for (const f of files) if (f.generated) f.scope = "generated";

    const totals = {};
    const bump = (key, f, launch) => {
      const t = (totals[key] ||= { files: 0, items: 0, lines: 0, bytes: 0, tokens: 0 });
      t.files++;
      t.items += f.items || 0;
      t.lines += f.lines || 0;
      t.bytes += f.bytes || 0;
      t.tokens += f.tokens || 0;
    };
    for (const f of files) bump(f.scope, f);
    const launch = files.filter((f) => f.loads === "launch");
    const launchTokens = launch.reduce((n, f) => n + f.tokens, 0);
    const warnings = [];
    for (const f of files) {
      if (f.loads === "launch" && /(CLAUDE|AGENTS)\.md$/.test(f.path) && f.lines > 200) warnings.push(`${f.path} is ${f.lines} lines (Anthropic advises under 200 per CLAUDE.md)`);
      if (f.loads === "on-demand" && f.bytes > ONDEMAND_CHARS) warnings.push(`${f.path} is ${f.bytes} bytes: over the ${ONDEMAND_CHARS}-character limit for files that load on demand, so Claude gets only its start`);
      if (f.truncated) warnings.push(`${f.path}: MEMORY.md is over its launch limit, entries past line 200 or 25 KB are not loaded`);
    }
    if (!memory.exists) notes.push(`no memory folder for this folder (expected ${memory.expected})`);
    if (nestedTotal > nestedCap) notes.push(`${nestedTotal - nestedCap} more nested files are listed without line counts`);
    let shown = o.launchOnly ? launch : files;
    if (!o.topics) {
      const topics = shown.filter((f) => f.scope === "memory" && f.loads === "on-demand");
      if (topics.length) {
        shown = shown.filter((f) => !topics.includes(f));
        shown.push({ path: memory.dir + "/*.md", scope: "memory", loads: "on-demand", files: topics.length, lines: topics.reduce((n, f) => n + f.lines, 0), bytes: topics.reduce((n, f) => n + f.bytes, 0), tokens: topics.reduce((n, f) => n + f.tokens, 0), items: topics.reduce((n, f) => n + f.items, 0), note: "memory topic files, read when needed (loaded(folder, {topics: true}) lists each)" });
      }
    }
    return {
      folder: F,
      gitRoot: git.root,
      instructionFiles: mode,
      agentsMdRead: agentsLoad,
      files: shown,
      totals,
      launch: { files: launch.length, tokens: launchTokens, note: "tokens are bytes/4; MEMORY.md counts only what loads" },
      memory,
      notes,
      warnings,
    };
  }

  // ---- items across files -----------------------------------------------------------------------
  async function allItems(folder, o = {}) {
    const info = await loaded(folder, { nested: o.nested !== false, nestedMax: o.nestedMax ?? 400, topics: true });
    const items = [];
    const seenHash = new Map();
    const identical = [];
    const meta = new Map(info.files.map((f) => [f.path, f]));
    for (const f of info.files) {
      if (f.loads === "no" && o.includeUnread === false) continue;
      let rec;
      try {
        rec = readFile(f.path);
      } catch {
        continue;
      }
      if (seenHash.has(rec.hash)) {
        identical.push({ path: f.path, sameAs: seenHash.get(rec.hash) });
        continue;
      }
      seenHash.set(rec.hash, f.path);
      for (const it of itemsOf(f.path)) {
        if (it.kind === "code" && !o.code) continue;
        items.push({ ...it, scope: f.scope, loads: f.loads, ...(f.repo ? { repo: f.repo } : {}), generated: !!rec.generated, memoryType: rec.fm?.type || undefined });
      }
    }
    return { info, items, identical, meta };
  }
  const loc = (it) => `${it.path}:${it.line}`;
  const view = (it, n = 300) => ({ at: loc(it), scope: it.scope, ...(it.repo ? { repo: it.repo } : {}), ...(it.generated ? { generated: true } : {}), ...(it.lesson ? { lesson: it.lesson.id } : {}), heading: it.heading || undefined, text: clip(it.text, n) });

  // ---- find -------------------------------------------------------------------------------------
  async function find(subject, o = {}) {
    const { info, items, identical } = await allItems(o.folder, o);
    let pool = items;
    if (o.scope) pool = pool.filter((i) => i.scope === o.scope);
    if (o.lessons) pool = pool.filter((i) => i.lesson);
    let results;
    let terms = [];
    if (o.pattern) {
      const re = new RegExp(o.pattern, "i");
      results = pool.filter((i) => re.test(i.text)).map((i) => ({ it: i, score: 1, matched: [] }));
    } else {
      terms = [...content(subject)];
      if (!terms.length) throw new Error("the subject has no searchable words");
      const df = new Map();
      const toks = new Map();
      for (const i of pool) {
        const t = content(i.text);
        toks.set(i, t);
        for (const w of terms) if (t.has(w)) df.set(w, (df.get(w) || 0) + 1);
      }
      const idf = (w) => Math.log(1 + pool.length / (1 + (df.get(w) || 0)));
      const need = o.all ? terms.length : 1;
      results = [];
      for (const i of pool) {
        const t = toks.get(i);
        const h = content(`${i.heading} ${path.basename(i.path)} ${i.memoryType || ""}`);
        let score = 0;
        const matched = [];
        for (const w of terms) {
          let s = 0;
          if (t.has(w)) s = 1;
          else if (w.length >= 4 && [...t].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))) s = 0.6;
          else if (h.has(w)) s = 0.5;
          if (s) {
            score += s * idf(w);
            matched.push(w);
          }
        }
        if (matched.length >= need) results.push({ it: i, score: score * (1 + 0.15 * (matched.length - 1)), matched });
      }
    }
    results.sort((a, b) => b.score - a.score || (a.it.generated ? 1 : 0) - (b.it.generated ? 1 : 0));
    const max = o.max ?? 25;
    const byFile = {};
    for (const r of results) byFile[r.it.path] = (byFile[r.it.path] || 0) + 1;
    return {
      folder: info.folder,
      subject,
      terms,
      searched: { files: info.files.length, items: pool.length },
      matches: results.length,
      shown: Math.min(max, results.length),
      results: results.slice(0, max).map((r) => ({ ...view(r.it, o.width ?? 260), score: +r.score.toFixed(2), matched: r.matched.join(",") })),
      filesHolding: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, n]) => ({ path: p, matches: n })),
      ...(identical.length ? { identicalCopiesSkipped: identical.length } : {}),
    };
  }

  // ---- count ------------------------------------------------------------------------------------
  async function count(folder, o = {}) {
    const { info, items, identical } = await allItems(folder, { ...o, nestedMax: 400 });
    const perFile = {};
    const perScope = {};
    for (const i of items) {
      const f = (perFile[i.path] ||= { path: i.path, scope: i.scope, loads: i.loads, ...(i.generated ? { generated: true } : {}), items: 0, kinds: {} });
      f.items++;
      f.kinds[i.kind] = (f.kinds[i.kind] || 0) + 1;
      const s = (perScope[i.scope] ||= { files: new Set(), items: 0 });
      s.files.add(i.path);
      s.items++;
    }
    const total = items.length;
    const generatedItems = items.filter((i) => i.generated).length;
    const launch = items.filter((i) => i.loads === "launch").length;
    return {
      folder: info.folder,
      total: { files: Object.keys(perFile).length, items: total, atLaunch: launch, generatedByMike: generatedItems, written: total - generatedItems },
      perScope: Object.fromEntries(Object.entries(perScope).map(([k, v]) => [k, { files: v.files.size, items: v.items }])),
      perFile: Object.values(perFile).sort((a, b) => b.items - a.items).slice(0, o.max ?? 40),
      filesNotShown: Math.max(0, Object.keys(perFile).length - (o.max ?? 40)),
      sizes: info.totals,
      launch: info.launch,
      ...(identical.length ? { identicalCopiesSkipped: identical.map((x) => x.path).slice(0, 10), identicalCopies: identical.length } : {}),
      method: "an item is one bullet, numbered item, table row or paragraph, headings and code blocks not counted",
    };
  }

  // ---- duplicates and conflicts -----------------------------------------------------------------
  function candidatePairs(items, minShared) {
    const sets = items.map((i) => content(i.text));
    const inv = new Map();
    sets.forEach((s, n) => {
      for (const w of s) (inv.get(w) || inv.set(w, []).get(w)).push(n);
    });
    const pairs = new Map();
    for (const [, list] of inv) {
      if (list.length > 60 || list.length < 2) continue;
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const k = list[a] * items.length + list[b];
        pairs.set(k, (pairs.get(k) || 0) + 1);
      }
    }
    const out = [];
    for (const [k, shared] of pairs) {
      if (shared < minShared) continue;
      const a = Math.floor(k / items.length);
      const b = k % items.length;
      out.push([a, b, sets[a], sets[b], shared]);
    }
    return out;
  }
  const sameIndexAndTopic = (a, b) => path.dirname(a.path) === path.dirname(b.path) && (path.basename(a.path) === "MEMORY.md" || path.basename(b.path) === "MEMORY.md");

  async function duplicates(folder, o = {}) {
    const { info, items } = await allItems(folder, o);
    const pool = items.filter((i) => i.kind !== "code" && content(i.text).size >= (i.kind === "row" ? 9 : (o.minWords ?? 6)));
    const thr = o.threshold ?? 0.5;
    const found = [];
    for (const [a, b, A, B, shared] of candidatePairs(pool, 4)) {
      const x = pool[a];
      const y = pool[b];
      if (x.path === y.path && !o.within) continue;
      if (sameIndexAndTopic(x, y)) continue;
      const jac = shared / (A.size + B.size - shared);
      const cont = shared / Math.min(A.size, B.size);
      if (jac >= thr || (cont >= 0.8 && Math.min(A.size, B.size) >= 8)) found.push({ similarity: +Math.max(jac, cont * 0.9).toFixed(2), ...(path.basename(x.path) === path.basename(y.path) ? { sameFileName: true } : {}), kind: jac >= thr ? "near-duplicate" : "one contains the other", a: view(x, 220), b: view(y, 220), ...(x.generated || y.generated ? { note: "one side is a lesson mike generates: change it through mike, not by editing the file" } : {}) });
    }
    found.sort((p, q) => (p.sameFileName ? 1 : 0) - (q.sameFileName ? 1 : 0) || q.similarity - p.similarity);
    const max = o.max ?? 25;
    return { folder: info.folder, itemsCompared: pool.length, threshold: thr, pairs: found.length, shown: Math.min(max, found.length), duplicates: found.slice(0, max), method: "content words (stems, no stop words) of each item; near-duplicate = Jaccard >= threshold" };
  }

  const NUM = /\b\d+(?:[.,]\d+)*\s?(?:kb|mb|gb|ms|s|sec|seconds?|minutes?|min|hours?|h|days?|%|lines?|chars?|characters?|tokens?|k)?\b/gi;
  async function conflicts(folder, o = {}) {
    const { info, items } = await allItems(folder, o);
    const pool = items.filter((i) => i.kind !== "code" && content(i.text).size >= 4 && !/^\*{0,2}(why|how to apply):/i.test(i.text));
    const found = [];
    const pol = (t) => (NEG.test(t) ? "never" : POS.test(t) ? "always" : null);
    for (const [a, b, A, B, shared] of candidatePairs(pool, 3)) {
      const x = pool[a];
      const y = pool[b];
      if (sameIndexAndTopic(x, y) || shared < 4) continue;
      const jac = shared / (A.size + B.size - shared);
      if (jac < (o.minOverlap ?? 0.15) || jac > 0.85) continue; // above 0.85 it is a duplicate
      const px = pol(x.text);
      const py = pol(y.text);
      const common = [...A].filter((w) => B.has(w));
      if (px && py && px !== py) found.push({ kind: "opposite wording", overlap: +jac.toFixed(2), shared: common.slice(0, 8), a: { ...view(x, 220), says: px }, b: { ...view(y, 220), says: py } });
      else {
        const nx = new Set((x.text.match(NUM) || []).map((n) => n.toLowerCase().replace(/\s/g, "")));
        const ny = new Set((y.text.match(NUM) || []).map((n) => n.toLowerCase().replace(/\s/g, "")));
        const onlyX = [...nx].filter((n) => !ny.has(n));
        const onlyY = [...ny].filter((n) => !nx.has(n));
        if (jac >= 0.3 && nx.size && ny.size && onlyX.length && onlyY.length && x.path !== y.path) found.push({ kind: "different numbers", overlap: +jac.toFixed(2), shared: common.slice(0, 8), values: { a: onlyX, b: onlyY }, a: view(x, 220), b: view(y, 220) });
      }
    }
    found.sort((p, q) => q.overlap - p.overlap);
    const max = o.max ?? 25;
    return { folder: info.folder, itemsCompared: pool.length, candidates: found.length, shown: Math.min(max, found.length), conflicts: found.slice(0, max), note: "candidates from wording only; read both sides before calling either a contradiction, and never remove a rule because of one" };
  }

  // ---- stale ------------------------------------------------------------------------------------
  let pathDirs = null;
  const onPath = (cmd) => {
    if (!pathDirs) {
      pathDirs = new Set();
      for (const d of (process.env.PATH || "").split(path.delimiter)) {
        try {
          for (const e of fs.readdirSync(d)) pathDirs.add(e);
        } catch {}
      }
      for (const b of "cd echo export source test type alias exit set unset ulimit umask wait read printf true false command exec eval".split(" ")) pathDirs.add(b);
    }
    return pathDirs.has(cmd);
  };
  const projectRootOf = (abs) => {
    for (let d = path.dirname(abs); d !== path.dirname(d); d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, ".git"))) return d;
    }
    const m = abs.match(/^(.*)\/\.claude\//);
    return m ? m[1] : path.dirname(abs);
  };
  const remoteRe = remoteWords.length ? new RegExp("\\b(" + remoteWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i") : /(?!)/;
  const BUILTIN_AGENTS = new Set(["explore", "plan", "general-purpose", "claude", "claude-code-guide", "statusline-setup", "web-fetch"]);

  async function stale(folder, o = {}) {
    const { info, items } = await allItems(folder, { ...o, code: true });
    const F = info.folder;
    const today = new Date();
    const findings = [];
    const checked = { items: 0, paths: 0, commands: 0, skillsAndAgents: 0, links: 0 };
    const exists = (p) => {
      try {
        fs.lstatSync(p);
        return true;
      } catch {
        return false;
      }
    };
    let fileList = null; // every file under the folder's repository, to resolve abbreviated paths like ui/motion.css
    const listing = async () => {
      if (fileList) return fileList;
      const r = await execP("rg", ["--files", "--hidden", "-g", "!.git", "-g", "!node_modules", "-g", "!target", info.gitRoot || F], { timeout: 15_000 });
      const root = (info.gitRoot || F) + "/";
      fileList = r.out.split("\n").filter(Boolean).map((l) => "/" + l.replace(root, ""));
      return fileList;
    };
    const suffixMatch = async (tok) => {
      const t = "/" + tok.replace(/^\.\//, "");
      const list = await listing();
      return tok.endsWith("/") ? list.some((f) => f.includes(t)) : list.some((f) => f.endsWith(t));
    };
    const add = (it, kind, ref, why, confidence) => findings.push({ kind, at: loc(it), scope: it.scope, ...(it.generated ? { generated: true } : {}), ref, why, confidence, text: clip(it.text, 160) });
    for (const it of items) {
      checked.items++;
      const root = projectRootOf(it.path);
      const bases = [path.dirname(it.path), root, F, path.join(home, ".claude"), home];
      const text = it.text;
      // backticked spans
      for (const m of text.matchAll(/`([^`\n]{1,200})`/g)) {
        const span = m[1].trim();
        for (let tok of span.split(/\s+/)) {
          tok = tok.replace(/[,;.)]+$/, "").replace(/^["'(]/, "");
          if (/[*?{}[\]<>$|=\\]|:\/\//.test(tok) || !/\//.test(tok) || /__[A-Z][A-Z_]*__/.test(tok)) continue; // globs, URLs, template placeholders
          tok = tok.replace(/:\d+(?:-\d+)?$/, "");
          const segs = tok.split("/").filter(Boolean);
          const abs = /^(~|\/)/.test(tok);
          if (abs && segs.length < 2) continue; // /doctor, /clear
          if (tok.startsWith("/") && !fs.existsSync("/" + segs[0])) continue; // /api/health is a URL path, not a file
          if (!abs && !/^\.{1,2}\//.test(tok) && !/\.\w{1,5}$/.test(tok) && !tok.endsWith("/")) continue; // src/api is a phrase more often than a path
          if (/^(and|or|yes|no)\//i.test(tok)) continue;
          checked.paths++;
          let ok = abs ? exists(expand(tok)) : bases.some((b) => exists(path.join(b, tok)));
          if (!ok && !abs && !/^\.{1,2}\//.test(tok)) ok = await suffixMatch(tok);
          const remote = remoteRe.test(text);
          if (!ok) add(it, "missing path", tok, remote ? "no such path here; the item talks about another machine, so it may exist there" : abs ? "no such path" : `not found relative to ${path.relative(home, root) || root}, the folder, or ~/.claude`, remote ? "low" : abs ? "high" : /\.\w{1,5}$/.test(tok) ? "medium" : "low");
        }
      }
      // commands introduced by a verb: run `x`, call `x`, use `x`
      for (const m of text.matchAll(/\b(?:[Rr]un|[Rr]uns|[Rr]unning|[Cc]all|[Cc]alls|[Ii]nvoke)\s+`([a-z][a-z0-9_+-]*)(?:\s[^`]*)?`/g)) {
        const cmd = m[1];
        if (it.kind === "code" || /(?:never|not|n't|avoid|without)\s+$/i.test(text.slice(Math.max(0, m.index - 14), m.index))) continue; // a rule that forbids a command does not need it to exist
        checked.commands++;
        if (!onPath(cmd) && !fs.existsSync(path.join(home, ".local", "bin", cmd))) {
          const asPath = bases.some((b) => exists(path.join(b, cmd)));
          if (!asPath) add(it, "missing command", cmd, "not on PATH here (a shell alias or function would not show)", "low");
        }
      }
      // skills and agents named in words
      for (const m of text.matchAll(/`([\w:-]+)`\s+(skill|agent|subagent)\b|\b(skill|agent|subagent)\s+`([\w:-]+)`/gi)) {
        const name = m[1] || m[4];
        const kindW = (m[2] || m[3]).toLowerCase();
        if (!name || name.includes(":")) continue;
        checked.skillsAndAgents++;
        const dirs = [claudeDir, path.join(root, ".claude")];
        const has = kindW === "skill" ? dirs.some((d) => isDir(path.join(d, "skills", name)) || isFile(path.join(d, "commands", name + ".md"))) : dirs.some((d) => isFile(path.join(d, "agents", name + ".md"))) || BUILTIN_AGENTS.has(name.toLowerCase());
        if (!has) add(it, `missing ${kindW}`, name, `no ${kindW} of that name in ~/.claude or the project's .claude (a plugin or built-in could supply it)`, "low");
      }
      // memory links and markdown links
      if (it.scope === "memory") {
        for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
          checked.links++;
          const n = m[1].trim();
          if (!exists(path.join(path.dirname(it.path), n.endsWith(".md") ? n : n + ".md"))) add(it, "broken memory link", `[[${n}]]`, "no memory file of that name", "high");
        }
      }
      for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const t = m[1];
        if (/^[a-z]+:|^\/\/|^#/.test(t)) continue;
        checked.links++;
        const ok = t.startsWith("/") || t.startsWith("~") ? exists(expand(t)) : exists(path.join(path.dirname(it.path), t));
        if (!ok) add(it, "broken link", t, "the linked file does not exist", "high");
      }
      // timebombs
      for (const m of text.matchAll(/\b(?:until|till|before|expires?(?: on)?|deadline|through|by|no later than)\s+(20\d\d-\d\d-\d\d)\b/gi)) {
        const d = new Date(m[1] + "T23:59:59Z");
        if (d < today) add(it, "date in the past", m[1], "the rule is tied to a date that has passed", /until|till|expire|deadline|later/i.test(m[0]) ? "medium" : "low");
      }
      if (/\b(temporar(?:y|ily)|for now|until further notice|workaround|stop-gap|once .{3,40} (?:is|are) (?:fixed|done|merged|released))\b/i.test(text) && it.kind !== "code") add(it, "temporary wording", (text.match(/temporar\w+|for now|until further notice|workaround|stop-gap|once .{3,40}/i) || [""])[0], "worded as a stop-gap: check whether it is still needed", "low");
    }

    // memory folder checks
    const memoryIssues = [];
    const md = info.memory.dir;
    if (md) {
      const idxPath = path.join(md, "MEMORY.md");
      const topic = walkMd(md).filter((p) => path.basename(p) !== "MEMORY.md");
      let idxText = "";
      if (isFile(idxPath)) {
        const r = readFile(idxPath);
        idxText = r.raw;
        if (r.lines > LAUNCH_LINES || r.bytes > LAUNCH_BYTES) memoryIssues.push({ at: idxPath, issue: `index is ${r.lines} lines and ${r.bytes} bytes; only 200 lines or 25 KB load` });
      } else if (topic.length) memoryIssues.push({ at: idxPath, issue: "no MEMORY.md index: nothing loads at launch" });
      for (const p of topic) {
        const r = readFile(p);
        const b = path.basename(p);
        if (!idxText.includes(`(${b})`) && !idxText.includes(`(${path.relative(md, p)})`)) memoryIssues.push({ at: p, issue: "not listed in MEMORY.md" });
        const type = r.fm?.type;
        for (const k of ["name", "description"]) if (!r.fm?.[k]) memoryIssues.push({ at: p, issue: `front matter has no ${k}` });
        if (!type) memoryIssues.push({ at: p, issue: "front matter has no type (metadata.type: user, feedback, project or reference)" });
        else if (["feedback", "project"].includes(type) && !(/why:/i.test(r.raw) && /how to apply:/i.test(r.raw))) memoryIssues.push({ at: p, issue: `${type} memory lacks a Why: or How to apply: line` });
        const age = Math.floor((today - new Date(r.fm?.modified || r.mtime)) / 86_400_000);
        if (type === "project" && age > 30) memoryIssues.push({ at: p, issue: `project memory last modified ${age} days ago: project facts go stale fast, check it against the repository`, confidence: "low" });
      }
      for (const m of idxText.matchAll(/\]\(([^)\s]+\.md)\)/g)) if (!isFile(path.join(md, m[1]))) memoryIssues.push({ at: idxPath, issue: `index points at ${m[1]}, which does not exist` });
    }
    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => order[a.confidence] - order[b.confidence]);
    const byKind = {};
    for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    const max = o.max ?? 40;
    return {
      folder: F,
      checked,
      findings: findings.length,
      byKind,
      shown: Math.min(max, findings.length),
      stale: findings.slice(0, max),
      memoryIssues,
      note: "a finding is a candidate: a path may be created later, a command may be an alias, a skill may come from a plugin. Check before retiring a rule.",
    };
  }

  // ---- reading ----------------------------------------------------------------------------------
  function read(file, o = {}) {
    const abs = guardRead(file);
    const rec = readFile(abs);
    seen.set(abs, rec.sig);
    const lines = rec.raw.split("\n");
    const from = Math.max(1, o.from ?? 1);
    const to = Math.min(lines.length, o.to ?? from + 399);
    if (to - from + 1 > 400) throw new Error("at most 400 lines per read");
    return { file: abs, from, to, lines: rec.lines, bytes: rec.bytes, generated: rec.generated || undefined, frontmatter: rec.fm || undefined, text: lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join("\n") };
  }

  // ---- acting -----------------------------------------------------------------------------------
  const changesLog = [];
  function guardWrite(file, what) {
    if (!act) notInThisAsk(`rules.${what}`);
    const abs = guardRead(file);
    const exists = isFile(abs);
    if (path.basename(abs) === "mike-lessons.md" || (exists && readFile(abs).generated)) deny(`${abs} is generated by mike (its header says so). Lessons are changed in mike, never by editing this file: ask about mike through \`ask\` (about: "mike") to change or delete a lesson.`);
    if (exists) {
      if (!seen.has(abs)) deny(`read ${abs} first with rules.read(file) in this ask, so the change is made against what it holds now`);
      if (seen.get(abs) !== statSig(abs)) deny(`${abs} changed since you read it (another session may have edited it): read it again and redo the change`);
    }
    return { abs, exists };
  }
  function backup(abs) {
    if (!isFile(abs)) return null;
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const dir = path.join(state, stamp);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, abs.replace(/^\//, "").replace(/\//g, "__"));
    fs.copyFileSync(abs, dest);
    return dest;
  }
  function writeAtomic(abs, text) {
    const target = isFile(abs) ? real(abs) : abs;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, target);
    cache.delete(abs);
    seen.set(abs, statSig(abs));
  }
  const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
  const record = (c) => {
    changesLog.push(c);
    push({ kind: "rules", detail: `${c.action} ${c.file}`.slice(0, 200), size: (c.removed || "").length + (c.added || "").length });
    return c;
  };

  function edit(file, from, to, o = {}) {
    const { abs } = guardWrite(file, "edit");
    const raw = fs.readFileSync(abs, "utf8");
    if (!from) throw new Error("from must not be empty");
    const n = raw.split(from).length - 1;
    if (n === 0) throw new Error(`the text to replace is not in ${abs}`);
    if (n > 1 && !o.all) throw new Error(`the text to replace occurs ${n} times in ${abs}: give more of it, or pass { all: true }`);
    const at = lineOf(raw, raw.indexOf(from));
    const bk = backup(abs);
    writeAtomic(abs, o.all ? raw.split(from).join(to) : raw.replace(from, () => to));
    return record({ action: to === "" ? "removed text" : "edited", file: abs, line: at, replaced: o.all ? n : 1, removed: from, added: to, backup: bk });
  }

  function write(file, text) {
    const { abs, exists } = guardWrite(file, "write");
    if (memoryFileRe.test(abs) && path.basename(abs) !== "MEMORY.md") {
      const { fm } = frontmatter(text);
      if (!fm?.name || !fm?.description || !fm?.type) deny("a memory file needs front matter with name, description and metadata.type: use rules.remember(...), which also adds the MEMORY.md line");
    }
    const bk = backup(abs);
    const before = exists ? fs.readFileSync(abs, "utf8") : "";
    writeAtomic(abs, text);
    return record({ action: exists ? "rewrote" : "created", file: abs, linesBefore: before ? before.split("\n").length : 0, linesAfter: text.split("\n").length, removed: exists ? clip(before, 800) : "", added: clip(text, 800), backup: bk });
  }

  function remove(file) {
    const { abs, exists } = guardWrite(file, "remove");
    if (!exists) throw new Error(`${abs} does not exist`);
    const raw = fs.readFileSync(abs, "utf8");
    const bk = backup(abs);
    fs.unlinkSync(abs);
    cache.delete(abs);
    const warn = memoryFileRe.test(abs) && path.basename(abs) !== "MEMORY.md" ? "this was a memory file: its MEMORY.md line is still there, use rules.forget(file) to remove both" : undefined;
    return record({ action: "deleted file", file: abs, lines: raw.split("\n").length, removed: clip(raw, 800), backup: bk, ...(warn ? { warning: warn } : {}) });
  }

  async function memoryDirFor(folder) {
    const info = await loaded(folder, { nested: false, topics: true });
    return info.memory.dir || info.memory.expected;
  }

  async function remember(o) {
    if (!act) notInThisAsk("rules.remember");
    const { name, description, type, body, hook } = o;
    let { file } = o;
    if (!name || !description || !type || !body || !file) throw new Error("remember needs file, name, description, type and body");
    if (!["user", "feedback", "project", "reference"].includes(type)) throw new Error("type is user, feedback, project or reference");
    if (/[\\/]/.test(file)) throw new Error("file is a bare name like feedback_testing.md, no folders");
    if (!file.endsWith(".md")) file += ".md";
    if (file === "MEMORY.md") throw new Error("MEMORY.md is the index");
    if (["feedback", "project"].includes(type) && !(/why:/i.test(body) && /how to apply:/i.test(body))) throw new Error(`a ${type} memory carries a "**Why:**" line and a "**How to apply:**" line in its body`);
    const dir = o.dir ? path.resolve(expand(o.dir)) : await memoryDirFor(o.folder);
    const target = path.join(dir, file);
    if (!memoryFileRe.test(target)) deny(`${dir} is not a memory folder (~/.claude/projects/<slug>/memory)`);
    if (isFile(target)) throw new Error(`${target} exists: read it and use rules.edit, one fact per file`);
    const idx = path.join(dir, "MEMORY.md");
    const line = `- [${name}](${file}): ${clip(hook || description, 140)}`;
    let idxText = isFile(idx) ? fs.readFileSync(idx, "utf8") : "";
    if (isFile(idx) && (!seen.has(idx) || seen.get(idx) !== statSig(idx))) {
      readFile(idx);
      seen.set(idx, statSig(idx));
      idxText = fs.readFileSync(idx, "utf8");
    }
    const nextIdx = idxText.replace(/\n*$/, "\n") + line + "\n";
    if (nextIdx.split("\n").length - 1 > LAUNCH_LINES || Buffer.byteLength(nextIdx) > LAUNCH_BYTES) throw new Error("MEMORY.md would go over 200 lines or 25 KB: merge or drop old entries first");
    const similar = (await find(`${name} ${description}`, { folder: o.folder || dir, scope: "memory", max: 3 }).catch(() => ({ results: [] }))).results;
    const text = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nmetadata:\n  node_type: memory\n  type: ${type}\n---\n\n${body.trim()}\n`;
    const bk = backup(idx);
    writeAtomic(target, text);
    writeAtomic(idx, nextIdx);
    return record({ action: "remembered", file: target, indexLine: line, added: clip(text, 800), index: idx, backup: bk, similarExisting: similar.map((s) => ({ at: s.at, text: clip(s.text, 120) })) });
  }

  async function forget(file) {
    if (!act) notInThisAsk("rules.forget");
    const abs = path.resolve(expand(file));
    if (!memoryFileRe.test(abs) || path.basename(abs) === "MEMORY.md") deny("forget removes one memory topic file and its MEMORY.md line");
    if (!isFile(abs)) throw new Error(`${abs} does not exist`);
    if (!seen.has(abs)) deny(`read ${abs} first with rules.read(file)`);
    const raw = fs.readFileSync(abs, "utf8");
    const idx = path.join(path.dirname(abs), "MEMORY.md");
    const b = path.basename(abs);
    let removedLine = null;
    const bk = backup(abs);
    backup(idx);
    if (isFile(idx)) {
      const ls = fs.readFileSync(idx, "utf8").split("\n");
      const keep = ls.filter((l) => {
        const hit = l.includes(`(${b})`);
        if (hit) removedLine = l;
        return !hit;
      });
      writeAtomic(idx, keep.join("\n"));
    }
    fs.unlinkSync(abs);
    cache.delete(abs);
    return record({ action: "forgot memory", file: abs, removed: clip(raw, 800), indexLineRemoved: removedLine, backup: bk });
  }

  const memoryDirs = () => {
    const out = [];
    let ents = [];
    try {
      ents = fs.readdirSync(projectsDir);
    } catch {}
    for (const e of ents) {
      const m = path.join(projectsDir, e, "memory");
      if (isFile(path.join(m, "MEMORY.md"))) {
        const fs_ = walkMd(m);
        out.push({ slug: e, dir: m, files: fs_.length, bytes: fs_.reduce((n, p) => n + fs.statSync(p).size, 0), index: path.join(m, "MEMORY.md") });
      }
    }
    return out;
  };

  return {
    cwd,
    act,
    loaded,
    find,
    count,
    duplicates,
    conflicts,
    stale,
    read,
    items: (file) => {
      const abs = guardRead(file);
      return itemsOf(abs).map((i) => ({ ...view(i, 400), kind: i.kind, endLine: i.endLine }));
    },
    memoryDirs,
    slug: slugOf,
    edit,
    write,
    remove,
    remember,
    forget,
    changes: () => changesLog.slice(),
  };
}
