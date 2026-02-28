import {
  dirname,
  globToRegExp,
  isAbsolute,
  join,
  relative,
  SEPARATOR as sep,
} from "@std/path";

export const KEEPLIST_FILE = "#keeplist.txt";
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
};

type KeeplistConfig = {
  keepRules: string[];
  renameDirectives: RenameDirective[];
};

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
    .sort((a, b) => a.localeCompare(b));
}

export async function writeKeeplist(root: string): Promise<string[]> {
  const files = await listRelativeFiles(root);
  const lines = [GENERATED_KEEPLIST_HEADER, "", ...files];
  await Deno.writeTextFile(join(root, KEEPLIST_FILE), `${lines.join("\n")}\n`);
  return files;
}

function normalizeLiteralPath(input: string): string {
  let normalized = input.trim().replaceAll("\\", "/");

  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  normalized = normalized.replace(/\/+/g, "/");
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
    const line = lines[index].trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("# ")) {
      continue;
    }

    if (line.startsWith("!rename")) {
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

async function readKeeplistConfig(root: string): Promise<KeeplistConfig> {
  const text = await Deno.readTextFile(join(root, KEEPLIST_FILE));
  return parseKeeplist(text);
}

export async function readKeeplist(root: string): Promise<string[]> {
  const config = await readKeeplistConfig(root);
  return config.keepRules;
}

async function readValidatedKeeplist(root: string): Promise<KeeplistConfig> {
  let config: KeeplistConfig;
  try {
    config = await readKeeplistConfig(root);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${KEEPLIST_FILE} not found. Generate keeplist first.`);
    }
    throw error;
  }

  if (config.keepRules.length === 0) {
    throw new Error(`${KEEPLIST_FILE} is empty. Add at least one keep rule.`);
  }

  return config;
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
    return a.localeCompare(b);
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

export function getRemovableFiles(
  files: string[],
  rules: string[],
  protectedPaths: Iterable<string> = [],
): string[] {
  const matchers = compileKeepRules(rules);
  const protectedSet = new Set(
    Array.from(protectedPaths, (path) => path.replaceAll("\\", "/")),
  );

  return files.filter((file) => {
    if (file === KEEPLIST_FILE) {
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

export async function buildScanPlan(root: string): Promise<ScanPlan> {
  const files = await listRelativeFiles(root);
  const config = await readValidatedKeeplist(root);

  return {
    removableFiles: getRemovableFiles(
      files,
      config.keepRules,
      protectedPathsFromRenames(config.renameDirectives),
    ),
    plannedRenames: config.renameDirectives,
  };
}

export async function scanForRemoval(root: string): Promise<string[]> {
  const plan = await buildScanPlan(root);
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
            results.push({ ...rename, applied: false, reason: "missing_source" });
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

export async function cleanFolderDetailed(root: string): Promise<CleanResult> {
  const plan = await buildScanPlan(root);

  for (const file of plan.removableFiles) {
    await Deno.remove(join(root, file));
  }

  const renameResults = await applyRenames(root, plan.plannedRenames);

  await pruneEmptyParentDirs(root, plan.removableFiles);

  return {
    removedFiles: plan.removableFiles,
    renameResults,
  };
}

export async function cleanFolder(root: string): Promise<string[]> {
  const result = await cleanFolderDetailed(root);
  return result.removedFiles;
}
