import {
  dirname,
  globToRegExp,
  isAbsolute,
  join,
  relative,
  SEPARATOR as sep,
} from "@std/path";

export const KEEPLIST_FILE = "#keeplist.txt";
export const QUARANTINE_DIR = ".modcleaner_quarantine";
export const GENERATED_KEEPLIST_HEADER = [
  "# This file defines which files should be preserved during the Clean operation.",
  "# The !rename directive specifies a literal backup restore rule.",
  "",
  "# !rename directives restore backups only if the target file is absent.",
  "# To restore vanilla files (e.g. remove a modloader proxy),",
  "# comment out the keep rule for the target file and run Clean.",
  "# Example: modloader proxy toggle",
  "",
  "# common_proxy.dll",
  "# !rename common_proxy.dll.orig -> common_proxy.dll",
  "",
  "# Explanation:",
  "# - While common_proxy.dll is listed as a keep rule, it will be preserved.",
  "# - The !rename directive will only apply if common_proxy.dll does not exist.",
  "# - To restore the original file from common_proxy.dll.orig,",
  "#   comment out the keep rule and run Clean.",
  "# Note: comments must be a # followed by a single space (some games use filenames with #, so the space is necessary to avoid confusion).",
].join("\n");

export type RenameDirective = {
  from: string;
  to: string;
};

export type ScanPlan = {
  removableFiles: string[];
  plannedRenames: RenameDirective[];
};

export type RenameExecutionResult = {
  from: string;
  to: string;
  applied: boolean;
  reason?: "missing_source" | "target_exists";
};

export type CleanResult = {
  removedFiles: string[];
  renameResults: RenameExecutionResult[];
  mode: CleanMode;
  quarantineRunId?: string;
};

export type CleanMode = "delete" | "quarantine";

export type CleanFolderDetailedOptions = {
  mode?: CleanMode;
  keeplistName?: string;
};

export type CleanFromPlanOptions = {
  mode?: CleanMode;
  keeplistName?: string;
};

type KeeplistConfig = {
  keepRules: string[];
  renameDirectives: RenameDirective[];
};

function compareLexically(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function validateKeeplistName(keeplistName: string): void {
  // Reject names with leading or trailing whitespace so that validation
  // and subsequent filesystem operations use the same literal value.
  if (keeplistName !== keeplistName.trim()) {
    throw new Error(
      `Invalid keeplist name: ${keeplistName}. Leading or trailing whitespace is not allowed.`,
    );
  }

  const normalized = keeplistName.trim();
  if (
    normalized !== KEEPLIST_FILE &&
    !/^#[A-Za-z0-9_-]+-keeplist\.txt$/.test(normalized)
  ) {
    throw new Error(
      `Invalid keeplist name: ${normalized}. Expected #keeplist.txt or #<prefix>-keeplist.txt.`,
    );
  }
}

export function resolveKeeplistName(prefix: string | null): string {
  if (!prefix) {
    return KEEPLIST_FILE;
  }

  return `#${prefix}-keeplist.txt`;
}

export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile) {
        files.push(fullPath);
        continue;
      }
      if (entry.isDirectory) {
        const relPath = relative(root, fullPath).replaceAll("\\", "/");
        if (
          relPath === QUARANTINE_DIR || relPath.startsWith(`${QUARANTINE_DIR}/`)
        ) {
          continue;
        }
        await walk(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

export function normalizeRelativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

export async function listRelativeFiles(root: string): Promise<string[]> {
  const files = await walkFiles(root);
  return files
    .map((file) => normalizeRelativePath(root, file))
    .sort(compareLexically);
}

export async function writeKeeplist(
  root: string,
  keeplistName = KEEPLIST_FILE,
): Promise<string[]> {
  validateKeeplistName(keeplistName);
  const files = await listRelativeFiles(root);
  const lines = [GENERATED_KEEPLIST_HEADER, "", ...files];
  await Deno.writeTextFile(join(root, keeplistName), `${lines.join("\n")}\n`);
  return files;
}

function normalizeLiteralPath(input: string): string {
  let normalized = input.trim().replaceAll("\\", "/");

  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  return normalized;
}

function validateLiteralRelativePath(
  path: string,
  lineNumber: number,
  side: "from" | "to",
): void {
  if (!path) {
    throw new Error(
      `Invalid !rename on line ${lineNumber}: missing ${side} path.`,
    );
  }

  if (isAbsolute(path) || /^[A-Za-z]:\//.test(path)) {
    throw new Error(
      `Invalid !rename on line ${lineNumber}: ${side} path must be relative.`,
    );
  }

  if (
    path.includes("*") || path.includes("?") || path.includes("[") ||
    path.includes("]")
  ) {
    throw new Error(
      `Invalid !rename on line ${lineNumber}: wildcards are not allowed in ${side} path.`,
    );
  }

  const segments = path.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error(
      `Invalid !rename on line ${lineNumber}: ${side} path must be a clean relative path.`,
    );
  }
}

function parseRenameDirective(
  line: string,
  lineNumber: number,
): RenameDirective {
  const renameBody = line.slice("!rename".length).trim();
  const match = renameBody.match(/^(.*?)\s*->\s*(.*?)$/);
  if (!match) {
    throw new Error(
      `Invalid !rename on line ${lineNumber}: expected '!rename <from> -> <to>'.`,
    );
  }

  const from = normalizeLiteralPath(match[1]);
  const to = normalizeLiteralPath(match[2]);

  validateLiteralRelativePath(from, lineNumber, "from");
  validateLiteralRelativePath(to, lineNumber, "to");

  if (from === to) {
    throw new Error(
      `Invalid !rename on line ${lineNumber}: from and to paths are identical.`,
    );
  }

  return { from, to };
}

function parseKeeplist(text: string): KeeplistConfig {
  const keepRules: string[] = [];
  const renameDirectives: RenameDirective[] = [];
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    // Only a literal "# " at the start of the line is a comment.
    if (rawLine.startsWith("# ")) {
      continue;
    }

    if (/^!rename(\s|$)/.test(line)) {
      const directive = parseRenameDirective(line, lineNumber);

      if (seenFrom.has(directive.from)) {
        throw new Error(
          `Invalid !rename on line ${lineNumber}: duplicate source path '${directive.from}'.`,
        );
      }
      if (seenTo.has(directive.to)) {
        throw new Error(
          `Invalid !rename on line ${lineNumber}: duplicate target path '${directive.to}'.`,
        );
      }

      seenFrom.add(directive.from);
      seenTo.add(directive.to);
      renameDirectives.push(directive);
      continue;
    }

    keepRules.push(line);
  }

  return { keepRules, renameDirectives };
}

async function readKeeplistConfig(
  root: string,
  keeplistName: string,
): Promise<KeeplistConfig> {
  validateKeeplistName(keeplistName);
  const text = await Deno.readTextFile(join(root, keeplistName));
  return parseKeeplist(text);
}

export async function readKeeplist(
  root: string,
  keeplistName = KEEPLIST_FILE,
): Promise<string[]> {
  const config = await readKeeplistConfig(root, keeplistName);
  return config.keepRules;
}

async function readValidatedKeeplist(
  root: string,
  keeplistName: string,
): Promise<KeeplistConfig> {
  let config: KeeplistConfig;
  try {
    config = await readKeeplistConfig(root, keeplistName);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${keeplistName} not found. Generate keeplist first.`);
    }
    throw error;
  }

  if (config.keepRules.length === 0) {
    throw new Error(`${keeplistName} is empty. Add at least one keep rule.`);
  }

  return config;
}

export async function assertKeeplistReady(
  root: string,
  keeplistName = KEEPLIST_FILE,
): Promise<void> {
  await readValidatedKeeplist(root, keeplistName);
}

function normalizeRule(rule: string): string {
  let normalized = rule.trim().replaceAll("\\", "/");

  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  if (normalized.endsWith("/")) {
    normalized = `${normalized}**`;
  }

  return normalized;
}

async function isEmptyFolder(path: string): Promise<boolean> {
  try {
    for await (const _ of Deno.readDir(path)) {
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function collectCandidateParentDirs(removedFiles: string[]): string[] {
  const dirs = new Set<string>();

  for (const file of removedFiles) {
    let current = dirname(file).replaceAll("\\", "/");
    while (current && current !== "." && current !== "/") {
      dirs.add(current);
      const next = dirname(current).replaceAll("\\", "/");
      if (next === current) {
        break;
      }
      current = next;
    }
  }

  return Array.from(dirs).sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    if (depthA !== depthB) {
      return depthB - depthA;
    }
    return compareLexically(a, b);
  });
}

async function pruneEmptyParentDirs(
  root: string,
  removedFiles: string[],
): Promise<void> {
  const candidateDirs = collectCandidateParentDirs(removedFiles);

  for (const dir of candidateDirs) {
    const fullPath = join(root, dir);

    if (!(await isEmptyFolder(fullPath))) {
      continue;
    }

    try {
      await Deno.remove(fullPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw error;
    }
  }
}

function compileRule(rule: string): RegExp | null {
  const normalizedRule = normalizeRule(rule);
  if (!normalizedRule) {
    return null;
  }

  return globToRegExp(normalizedRule, {
    extended: true,
    globstar: true,
  });
}

function compileKeepRules(rules: string[]): RegExp[] {
  return rules
    .map((rule) => compileRule(rule))
    .filter((matcher): matcher is RegExp => matcher !== null);
}

export function matchesKeepRule(path: string, rule: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  const matcher = compileRule(rule);
  if (!matcher) {
    return false;
  }

  return matcher.test(normalizedPath);
}

export function isKept(path: string, rules: string[]): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  const matchers = compileKeepRules(rules);
  return matchers.some((matcher) => matcher.test(normalizedPath));
}

function isKeptWithMatchers(path: string, matchers: RegExp[]): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  return matchers.some((matcher) => matcher.test(normalizedPath));
}

function isProtectedKeeplistPath(path: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.includes("/")) {
    return false;
  }

  return normalizedPath === KEEPLIST_FILE ||
    /^#[A-Za-z0-9_-]+-keeplist\.txt$/.test(normalizedPath);
}

export function getRemovableFiles(
  files: string[],
  rules: string[],
  protectedPaths: Iterable<string> = [],
  keeplistName = KEEPLIST_FILE,
): string[] {
  const matchers = compileKeepRules(rules);
  const protectedSet = new Set(
    Array.from(protectedPaths, (path) => path.replaceAll("\\", "/")),
  );

  return files.filter((file) => {
    if (file === keeplistName || isProtectedKeeplistPath(file)) {
      return false;
    }
    if (protectedSet.has(file.replaceAll("\\", "/"))) {
      return false;
    }
    return !isKeptWithMatchers(file, matchers);
  });
}

function protectedPathsFromRenames(renames: RenameDirective[]): string[] {
  return renames.flatMap((rename) => [rename.from, rename.to]);
}

export async function buildScanPlan(
  root: string,
  keeplistName = KEEPLIST_FILE,
): Promise<ScanPlan> {
  validateKeeplistName(keeplistName);
  const files = await listRelativeFiles(root);
  const config = await readValidatedKeeplist(root, keeplistName);

  return {
    removableFiles: getRemovableFiles(
      files,
      config.keepRules,
      protectedPathsFromRenames(config.renameDirectives),
      keeplistName,
    ),
    plannedRenames: config.renameDirectives,
  };
}

export async function scanForRemoval(
  root: string,
  keeplistName = KEEPLIST_FILE,
): Promise<string[]> {
  const plan = await buildScanPlan(root, keeplistName);
  return plan.removableFiles;
}

async function applyRenames(
  root: string,
  renames: RenameDirective[],
): Promise<RenameExecutionResult[]> {
  const results: RenameExecutionResult[] = [];

  for (const rename of renames) {
    const sourcePath = join(root, rename.from);
    const targetPath = join(root, rename.to);

    try {
      await Deno.stat(targetPath);
      results.push({ ...rename, applied: false, reason: "target_exists" });
      continue;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    try {
      await Deno.rename(sourcePath, targetPath);
      results.push({ ...rename, applied: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        try {
          await Deno.stat(sourcePath);
        } catch (sourceError) {
          if (sourceError instanceof Deno.errors.NotFound) {
            results.push({
              ...rename,
              applied: false,
              reason: "missing_source",
            });
            continue;
          }

          throw sourceError;
        }
      }
      throw error;
    }
  }

  return results;
}

function buildQuarantineRunId(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

async function quarantineFiles(
  root: string,
  removableFiles: string[],
): Promise<{ runId?: string; movedFiles: string[] }> {
  if (removableFiles.length === 0) {
    return { runId: undefined, movedFiles: [] };
  }

  const runId = buildQuarantineRunId();
  const quarantineRoot = join(root, QUARANTINE_DIR, runId);
  const movedFiles: string[] = [];

  for (const file of removableFiles) {
    const sourcePath = join(root, file);
    const targetPath = join(quarantineRoot, file);
    await Deno.mkdir(dirname(targetPath), { recursive: true });
    try {
      await Deno.rename(sourcePath, targetPath);
      movedFiles.push(file);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw error;
    }
  }

  return { runId: movedFiles.length === 0 ? undefined : runId, movedFiles };
}

function validatePlanRelativePath(path: string, kind: string): string {
  const normalizedPath = normalizeLiteralPath(path);

  if (!normalizedPath) {
    throw new Error(`Invalid scan plan: ${kind} path is empty.`);
  }

  if (isAbsolute(normalizedPath) || /^[A-Za-z]:\//.test(normalizedPath)) {
    throw new Error(
      `Invalid scan plan: ${kind} path '${normalizedPath}' must be relative.`,
    );
  }

  if (
    normalizedPath.includes("*") || normalizedPath.includes("?") ||
    normalizedPath.includes("[") || normalizedPath.includes("]")
  ) {
    throw new Error(
      `Invalid scan plan: wildcards are not allowed in ${kind} path '${normalizedPath}'.`,
    );
  }

  const segments = normalizedPath.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error(
      `Invalid scan plan: ${kind} path '${normalizedPath}' must be a clean relative path.`,
    );
  }

  return normalizedPath;
}

function validateScanPlanInput(plan: ScanPlan): ScanPlan {
  const removableFiles: string[] = [];
  const plannedRenames: RenameDirective[] = [];
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();

  for (const file of plan.removableFiles) {
    const normalizedFile = validatePlanRelativePath(file, "removable file");
    if (isProtectedKeeplistPath(normalizedFile)) {
      throw new Error(
        `Invalid scan plan: removable file '${normalizedFile}' is protected.`,
      );
    }
    removableFiles.push(normalizedFile);
  }

  const removableSet = new Set(removableFiles);

  for (const rename of plan.plannedRenames) {
    const from = validatePlanRelativePath(rename.from, "rename from");
    const to = validatePlanRelativePath(rename.to, "rename to");

    if (from === to) {
      throw new Error(
        `Invalid scan plan: rename source and target are identical ('${from}').`,
      );
    }

    if (seenFrom.has(from)) {
      throw new Error(
        `Invalid scan plan: duplicate rename source path '${from}'.`,
      );
    }

    if (seenTo.has(to)) {
      throw new Error(
        `Invalid scan plan: duplicate rename target path '${to}'.`,
      );
    }

    if (removableSet.has(from) || removableSet.has(to)) {
      throw new Error(
        `Invalid scan plan: rename path overlaps removable file ('${removableSet.has(from) ? from : to}').`,
      );
    }

    seenFrom.add(from);
    seenTo.add(to);
    plannedRenames.push({ from, to });
  }

  return { removableFiles, plannedRenames };
}

export async function cleanFolderDetailed(
  root: string,
  options: CleanFolderDetailedOptions = {},
): Promise<CleanResult> {
  const plan = await buildScanPlan(root, options.keeplistName ?? KEEPLIST_FILE);
  return cleanFromPlan(root, plan, {
    mode: options.mode,
    keeplistName: options.keeplistName,
  });
}

export async function cleanFromPlan(
  root: string,
  plan: ScanPlan,
  options: CleanFromPlanOptions = {},
): Promise<CleanResult> {
  const mode = options.mode ?? "delete";
  const keeplistName = options.keeplistName ?? KEEPLIST_FILE;

  if (mode !== "delete" && mode !== "quarantine") {
    throw new Error(`Invalid clean mode: ${mode}`);
  }

  const validatedPlan = validateScanPlanInput(plan);
  await readValidatedKeeplist(root, keeplistName);

  let quarantineRunId: string | undefined;
  const removedFiles: string[] = [];

  if (mode === "delete") {
    for (const file of validatedPlan.removableFiles) {
      try {
        await Deno.remove(join(root, file));
        removedFiles.push(file);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          continue;
        }
        throw error;
      }
    }
  } else {
    const quarantineResult = await quarantineFiles(
      root,
      validatedPlan.removableFiles,
    );
    quarantineRunId = quarantineResult.runId;
    removedFiles.push(...quarantineResult.movedFiles);
  }

  const renameResults = await applyRenames(root, validatedPlan.plannedRenames);

  await pruneEmptyParentDirs(root, removedFiles);

  return {
    removedFiles,
    renameResults,
    mode,
    quarantineRunId,
  };
}

export async function cleanFolder(
  root: string,
  keeplistName = KEEPLIST_FILE,
): Promise<string[]> {
  const result = await cleanFolderDetailed(root, { keeplistName });
  return result.removedFiles;
}
