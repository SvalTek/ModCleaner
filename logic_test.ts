import {
  buildScanPlan,
  cleanFolder,
  cleanFolderDetailed,
  GENERATED_KEEPLIST_HEADER,
  getRemovableFiles,
  isKept,
  KEEPLIST_FILE,
  listRelativeFiles,
  matchesKeepRule,
  normalizeRelativePath,
  QUARANTINE_DIR,
  readKeeplist,
  scanForRemoval,
  writeKeeplist,
} from "./logic.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";

Deno.test("matchesKeepRule supports * and **", () => {
  assertEquals(matchesKeepRule("mods/a.txt", "mods/**"), true);
  assertEquals(matchesKeepRule("mods/deep/file.bin", "mods/**"), true);
  assertEquals(
    matchesKeepRule("BepInEx/plugins/mod.dll", "BepInEx/plugins/*.dll"),
    true,
  );
  assertEquals(
    matchesKeepRule("BepInEx/plugins/sub/mod.dll", "BepInEx/plugins/*.dll"),
    false,
  );
});

Deno.test("matchesKeepRule normalizes backslash + leading ./ in rule", () => {
  assertEquals(matchesKeepRule("mods/deep/file.bin", "./mods\\**"), true);
  assertEquals(matchesKeepRule("other/file.bin", "./mods\\**"), false);
});

Deno.test("matchesKeepRule treats trailing slash rule as recursive glob", () => {
  assertEquals(matchesKeepRule("mods/top.txt", "mods/"), true);
  assertEquals(matchesKeepRule("mods/deep/nested/file.bin", "mods/"), true);
  assertEquals(matchesKeepRule("mods-similar/file.bin", "mods/"), false);
});

Deno.test("matchesKeepRule returns false for empty or whitespace rules", () => {
  assertEquals(matchesKeepRule("mods/a.txt", ""), false);
  assertEquals(matchesKeepRule("mods/a.txt", "   "), false);
});

Deno.test("isKept returns true when any keep rule matches", () => {
  assertEquals(isKept("mods/keep.dll", ["logs/**", "mods/*.dll"]), true);
});

Deno.test("isKept returns false when no keep rule matches", () => {
  assertEquals(isKept("mods/keep.dll", ["logs/**", "mods/*.txt"]), false);
});

Deno.test("getRemovableFiles ignores empty/whitespace keep rules in matcher pipeline", () => {
  const files = ["mods/kept.dll", "other/remove.tmp"];
  const removable = getRemovableFiles(files, ["   ", "\t", "", "mods/**"]);
  assertEquals(removable, ["other/remove.tmp"]);
});

Deno.test("getRemovableFiles never removes #keeplist.txt", () => {
  const files = ["#keeplist.txt", "mods/a.txt", "temp/b.log"];
  const removable = getRemovableFiles(files, ["mods/**"]);

  assertEquals(removable, ["temp/b.log"]);
});

Deno.test("writeKeeplist, scanForRemoval and cleanFolder workflow", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "mods"), { recursive: true });
    await Deno.mkdir(join(root, "logs"), { recursive: true });

    await Deno.writeTextFile(join(root, "mods", "keep.txt"), "keep");
    await Deno.writeTextFile(join(root, "logs", "delete.log"), "delete");

    await writeKeeplist(root);

    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "mods/**\n");

    const candidates = await scanForRemoval(root);
    assertEquals(candidates, ["logs/delete.log"]);

    const removed = await cleanFolder(root);
    assertEquals(removed, ["logs/delete.log"]);

    const logPath = join(root, "logs", "delete.log");
    let exists = true;
    try {
      await Deno.stat(logPath);
    } catch {
      exists = false;
    }

    assertEquals(exists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("writeKeeplist prepends generated header verbatim", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "mods"), { recursive: true });
    await Deno.writeTextFile(join(root, "mods", "keep.txt"), "keep");

    await writeKeeplist(root);

    const text = await Deno.readTextFile(join(root, KEEPLIST_FILE));
    const expected = `${GENERATED_KEEPLIST_HEADER}\n\nmods/keep.txt\n`;
    assertEquals(text, expected);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("listRelativeFiles returns deterministic lexicographic ordering", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "mods", "zeta"), { recursive: true });
    await Deno.mkdir(join(root, "mods", "alpha"), { recursive: true });
    await Deno.mkdir(join(root, "B"), { recursive: true });

    await Deno.writeTextFile(join(root, "mods", "zeta", "b.txt"), "b");
    await Deno.writeTextFile(join(root, "mods", "alpha", "a.txt"), "a");
    await Deno.writeTextFile(join(root, "B", "root.txt"), "r");

    const files = await listRelativeFiles(root);
    assertEquals(files, [
      "B/root.txt",
      "mods/alpha/a.txt",
      "mods/zeta/b.txt",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("normalizeRelativePath converts platform separators to forward slashes", async () => {
  const root = await Deno.makeTempDir();
  try {
    const filePath = join(root, "mods", "nested", "file.dll");
    assertEquals(normalizeRelativePath(root, filePath), "mods/nested/file.dll");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("writeKeeplist overwrites existing #keeplist.txt content", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "mods"), { recursive: true });
    await Deno.writeTextFile(join(root, "mods", "keep.txt"), "keep");
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      "old-rule-1\n!rename from.txt -> to.txt\nold-rule-2\n",
    );

    await writeKeeplist(root);

    const text = await Deno.readTextFile(join(root, KEEPLIST_FILE));
    assertEquals(text.startsWith(`${GENERATED_KEEPLIST_HEADER}\n\n`), true);
    assertEquals(text.includes("old-rule-1"), false);
    assertEquals(text.includes("old-rule-2"), false);
    assertEquals(text.includes("!rename from.txt -> to.txt"), false);
    assertEquals(text.includes("mods/keep.txt\n"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval fails when keeplist is missing", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "orphan.txt"), "x");
    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "#keeplist.txt not found",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolder fails when keeplist is empty", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "orphan.txt"), "x");
    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "\n");
    await assertRejects(
      () => cleanFolder(root),
      Error,
      "#keeplist.txt is empty",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("readKeeplist ignores '# ' comments but keeps literal # paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "# comment line",
        "mods/**",
        "#mods/literal-starts-with-hash.txt",
        "  # another comment",
        "",
      ].join("\n"),
    );

    const rules = await readKeeplist(root);
    assertEquals(rules, ["mods/**", "#mods/literal-starts-with-hash.txt"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("readKeeplist excludes !rename directives and returns only keep rules", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "mods/**",
        "!rename restore/backup.bin -> restore/live.bin",
        "plugins/*.dll",
      ].join("\n"),
    );

    const rules = await readKeeplist(root);
    assertEquals(rules, ["mods/**", "plugins/*.dll"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolder returns removed files only and mirrors cleanFolderDetailed removedFiles", async () => {
  async function setupRoot(): Promise<string> {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash"), { recursive: true });
    await Deno.mkdir(join(root, "restore"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "trash", "remove.tmp"), "remove");
    await Deno.writeTextFile(join(root, "restore", "backup.bin"), "backup");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename restore/backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    return root;
  }

  const detailedRoot = await setupRoot();
  const wrapperRoot = await setupRoot();

  try {
    const detailed = await cleanFolderDetailed(detailedRoot);
    const removedByWrapper = await cleanFolder(wrapperRoot);

    assertEquals(removedByWrapper, detailed.removedFiles);
    assertEquals(detailed.renameResults, [
      {
        from: "restore/backup.bin",
        to: "restore/live.bin",
        applied: true,
      },
    ]);
  } finally {
    await Deno.remove(detailedRoot, { recursive: true });
    await Deno.remove(wrapperRoot, { recursive: true });
  }
});

Deno.test("scan plan includes planned renames", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "Game", "Binaries", "Win64"), {
      recursive: true,
    });
    await Deno.mkdir(join(root, "keep"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(
      join(root, "Game", "Binaries", "Win64", "modloader-temp.dll"),
      "temp",
    );

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename Game/Binaries/Win64/exchndl-original.dll -> Game/Binaries/Win64/exchndl.dll",
      ].join("\n"),
    );

    const plan = await buildScanPlan(root);
    assertEquals(plan.removableFiles, [
      "Game/Binaries/Win64/modloader-temp.dll",
    ]);
    assertEquals(plan.plannedRenames, [
      {
        from: "Game/Binaries/Win64/exchndl-original.dll",
        to: "Game/Binaries/Win64/exchndl.dll",
      },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolder applies !rename after deletion and reports rename results", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "Game", "Binaries", "Win64"), {
      recursive: true,
    });
    await Deno.mkdir(join(root, "keep"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(
      join(root, "Game", "Binaries", "Win64", "exchndl-original.dll"),
      "original",
    );
    await Deno.writeTextFile(
      join(root, "Game", "Binaries", "Win64", "modloader-temp.dll"),
      "temp",
    );

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename Game/Binaries/Win64/exchndl-original.dll -> Game/Binaries/Win64/exchndl.dll",
      ].join("\n"),
    );

    const result = await cleanFolderDetailed(root);
    assertEquals(result.mode, "delete");
    assertEquals(result.quarantineRunId, undefined);
    assertEquals(result.removedFiles, [
      "Game/Binaries/Win64/modloader-temp.dll",
    ]);
    assertEquals(result.renameResults, [
      {
        from: "Game/Binaries/Win64/exchndl-original.dll",
        to: "Game/Binaries/Win64/exchndl.dll",
        applied: true,
      },
    ]);

    let oldExists = true;
    try {
      await Deno.stat(
        join(root, "Game", "Binaries", "Win64", "exchndl-original.dll"),
      );
    } catch {
      oldExists = false;
    }

    let newExists = true;
    try {
      await Deno.stat(join(root, "Game", "Binaries", "Win64", "exchndl.dll"));
    } catch {
      newExists = false;
    }

    assertEquals(oldExists, false);
    assertEquals(newExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed quarantine mode moves files into deterministic run layout without data loss", async () => {
  const root = await Deno.makeTempDir();

  const toIsoStub = stub(
    Date.prototype,
    "toISOString",
    () => "2026-01-02T03:04:05.678Z",
  );

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash", "nested"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(
      join(root, "trash", "nested", "remove.tmp"),
      "remove-content",
    );

    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "keep/**\n");

    const result = await cleanFolderDetailed(root, { mode: "quarantine" });
    assertEquals(result.mode, "quarantine");
    assertEquals(result.quarantineRunId, "2026-01-02T03-04-05.678Z");
    assertEquals(result.removedFiles, ["trash/nested/remove.tmp"]);

    const sourceExists = await Deno.stat(
      join(root, "trash", "nested", "remove.tmp"),
    )
      .then(() => true)
      .catch(() => false);
    assertEquals(sourceExists, false);

    const quarantinedPath = join(
      root,
      QUARANTINE_DIR,
      "2026-01-02T03-04-05.678Z",
      "trash",
      "nested",
      "remove.tmp",
    );
    const quarantinedContent = await Deno.readTextFile(quarantinedPath);
    assertEquals(quarantinedContent, "remove-content");
  } finally {
    toIsoStub.restore();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed quarantine mode still applies renames after removal phase", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash"), { recursive: true });
    await Deno.mkdir(join(root, "restore"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "trash", "remove.tmp"), "remove");
    await Deno.writeTextFile(join(root, "restore", "backup.bin"), "backup");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename restore/backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    const result = await cleanFolderDetailed(root, { mode: "quarantine" });
    assertEquals(result.renameResults, [
      {
        from: "restore/backup.bin",
        to: "restore/live.bin",
        applied: true,
      },
    ]);

    const renamedTargetExists = await Deno.stat(
      join(root, "restore", "live.bin"),
    )
      .then(() => true)
      .catch(() => false);
    assertEquals(renamedTargetExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed quarantine mode returns undefined runId when no files are removed", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "keep/**\n");

    const result = await cleanFolderDetailed(root, { mode: "quarantine" });
    assertEquals(result.mode, "quarantine");
    assertEquals(result.quarantineRunId, undefined);
    assertEquals(result.removedFiles, []);

    const quarantineDirExists = await Deno.stat(join(root, QUARANTINE_DIR))
      .then(() => true)
      .catch(() => false);
    assertEquals(quarantineDirExists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("listRelativeFiles and buildScanPlan exclude quarantine directory", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, QUARANTINE_DIR, "2026-01-01T00-00-00.000Z", "trash"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(
      join(root, QUARANTINE_DIR, "2026-01-01T00-00-00.000Z", "trash", "old.tmp"),
      "old",
    );
    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "keep/**\n");

    const files = await listRelativeFiles(root);
    assertEquals(files.includes(`${QUARANTINE_DIR}/2026-01-01T00-00-00.000Z/trash/old.tmp`), false);

    const plan = await buildScanPlan(root);
    assertEquals(plan.removableFiles.some((f) => f.startsWith(QUARANTINE_DIR)), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed prunes empty parent directories of removed files", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash", "nested"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(
      join(root, "trash", "nested", "remove.tmp"),
      "remove",
    );

    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "keep/**\n");

    const result = await cleanFolderDetailed(root);
    assertEquals(result.removedFiles, ["trash/nested/remove.tmp"]);

    const nestedExists = await Deno.stat(join(root, "trash", "nested"))
      .then(() => true)
      .catch(() => false);
    const trashExists = await Deno.stat(join(root, "trash"))
      .then(() => true)
      .catch(() => false);
    const keepExists = await Deno.stat(join(root, "keep"))
      .then(() => true)
      .catch(() => false);

    assertEquals(nestedExists, false);
    assertEquals(trashExists, false);
    assertEquals(keepExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed does not remove unrelated empty directories", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash"), { recursive: true });
    await Deno.mkdir(join(root, "unrelated", "empty"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "trash", "remove.tmp"), "remove");

    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "keep/**\n");

    const result = await cleanFolderDetailed(root);
    assertEquals(result.removedFiles, ["trash/remove.tmp"]);

    const unrelatedExists = await Deno.stat(join(root, "unrelated", "empty"))
      .then(() => true)
      .catch(() => false);
    assertEquals(unrelatedExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed keeps parent directory when it still contains kept files", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "mixed"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "mixed", "keep.txt"), "keep");
    await Deno.writeTextFile(join(root, "mixed", "remove.tmp"), "remove");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["keep/**", "mixed/keep.txt"].join("\n"),
    );

    const result = await cleanFolderDetailed(root);
    assertEquals(result.removedFiles, ["mixed/remove.tmp"]);

    const mixedExists = await Deno.stat(join(root, "mixed"))
      .then(() => true)
      .catch(() => false);
    const keptFileExists = await Deno.stat(join(root, "mixed", "keep.txt"))
      .then(() => true)
      .catch(() => false);

    assertEquals(mixedExists, true);
    assertEquals(keptFileExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects wildcard paths in !rename", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "mods/**",
        "!rename Game/Binaries/*.dll -> Game/Binaries/exchndl.dll",
      ].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "wildcards are not allowed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval is non-destructive", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash"), { recursive: true });
    await Deno.mkdir(join(root, "restore"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "trash", "remove.me"), "trash");
    await Deno.writeTextFile(join(root, "restore", "backup.bin"), "backup");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename restore/backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    const removable = await scanForRemoval(root);
    assertEquals(removable, ["trash/remove.me"]);

    const keepExists = await Deno.stat(join(root, "keep", "stay.txt"))
      .then(() => true)
      .catch(() => false);
    const trashExists = await Deno.stat(join(root, "trash", "remove.me"))
      .then(() => true)
      .catch(() => false);
    const backupExists = await Deno.stat(join(root, "restore", "backup.bin"))
      .then(() => true)
      .catch(() => false);
    const liveExists = await Deno.stat(join(root, "restore", "live.bin"))
      .then(() => true)
      .catch(() => false);

    assertEquals(keepExists, true);
    assertEquals(trashExists, true);
    assertEquals(backupExists, true);
    assertEquals(liveExists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("buildScanPlan protects rename from/to paths from removal", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "restore"), { recursive: true });
    await Deno.mkdir(join(root, "misc"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "restore", "backup.bin"), "backup");
    await Deno.writeTextFile(join(root, "restore", "live.bin"), "live");
    await Deno.writeTextFile(join(root, "misc", "remove.tmp"), "remove");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename restore/backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    const plan = await buildScanPlan(root);
    assertEquals(plan.removableFiles, ["misc/remove.tmp"]);
    assertEquals(plan.plannedRenames, [
      { from: "restore/backup.bin", to: "restore/live.bin" },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("buildScanPlan removable files remain lexicographically ordered", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "trash", "z"), { recursive: true });
    await Deno.mkdir(join(root, "trash", "a"), { recursive: true });
    await Deno.mkdir(join(root, "trash", "m"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "trash", "z", "3.tmp"), "3");
    await Deno.writeTextFile(join(root, "trash", "a", "1.tmp"), "1");
    await Deno.writeTextFile(join(root, "trash", "m", "2.tmp"), "2");

    await Deno.writeTextFile(join(root, KEEPLIST_FILE), "keep/**\n");

    const plan = await buildScanPlan(root);
    assertEquals(plan.removableFiles, [
      "trash/a/1.tmp",
      "trash/m/2.tmp",
      "trash/z/3.tmp",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed reports target_exists as non-fatal", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "restore"), { recursive: true });
    await Deno.mkdir(join(root, "misc"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "restore", "backup.bin"), "backup");
    await Deno.writeTextFile(join(root, "restore", "live.bin"), "existing");
    await Deno.writeTextFile(join(root, "misc", "remove.tmp"), "remove");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename restore/backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    const result = await cleanFolderDetailed(root);
    assertEquals(result.removedFiles, ["misc/remove.tmp"]);
    assertEquals(result.renameResults, [
      {
        from: "restore/backup.bin",
        to: "restore/live.bin",
        applied: false,
        reason: "target_exists",
      },
    ]);

    const backupExists = await Deno.stat(join(root, "restore", "backup.bin"))
      .then(() => true)
      .catch(() => false);
    assertEquals(backupExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed reports missing_source as non-fatal", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "restore"), { recursive: true });
    await Deno.mkdir(join(root, "misc"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "misc", "remove.tmp"), "remove");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename restore/backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    const result = await cleanFolderDetailed(root);
    assertEquals(result.removedFiles, ["misc/remove.tmp"]);
    assertEquals(result.renameResults, [
      {
        from: "restore/backup.bin",
        to: "restore/live.bin",
        applied: false,
        reason: "missing_source",
      },
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed treats missing rename target parent as fatal", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "misc"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "misc", "remove.tmp"), "remove");
    await Deno.writeTextFile(join(root, "backup.bin"), "backup");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    await assertRejects(() => cleanFolderDetailed(root), Error);

    const removedStillMissing = await Deno.stat(
      join(root, "misc", "remove.tmp"),
    )
      .then(() => false)
      .catch(() => true);
    const sourceStillExists = await Deno.stat(join(root, "backup.bin"))
      .then(() => true)
      .catch(() => false);

    assertEquals(removedStillMissing, true);
    assertEquals(sourceStillExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed propagates fatal rename errors without rollback", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.mkdir(join(root, "misc"), { recursive: true });

    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "misc", "remove.tmp"), "remove");
    await Deno.writeTextFile(join(root, "backup.bin"), "backup");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename backup.bin -> bad:dir/target.bin",
      ].join("\n"),
    );

    await assertRejects(() => cleanFolderDetailed(root), Error);

    const removedStillMissing = await Deno.stat(
      join(root, "misc", "remove.tmp"),
    )
      .then(() => false)
      .catch(() => true);
    const sourceStillExists = await Deno.stat(join(root, "backup.bin"))
      .then(() => true)
      .catch(() => false);

    assertEquals(removedStillMissing, true);
    assertEquals(sourceStillExists, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cleanFolderDetailed propagates fatal target stat errors", async () => {
  const root = await Deno.makeTempDir();

  try {
    await Deno.mkdir(join(root, "keep"), { recursive: true });
    await Deno.writeTextFile(join(root, "keep", "stay.txt"), "keep");
    await Deno.writeTextFile(join(root, "backup.bin"), "backup");

    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "keep/**",
        "!rename backup.bin -> restore/live.bin",
      ].join("\n"),
    );

    const realStat = Deno.stat;
    const statStub = stub(Deno, "stat", async (path: string | URL) => {
      if (String(path).endsWith(join("restore", "live.bin"))) {
        throw new Error("synthetic stat failure");
      }
      return await realStat(path);
    });

    try {
      await assertRejects(
        () => cleanFolderDetailed(root),
        Error,
        "synthetic stat failure",
      );
    } finally {
      statStub.restore();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects malformed !rename without arrow", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename from.txt to.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "expected '!rename <from> -> <to>'",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with missing from path", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename   -> to.txt"].join("\n"),
    );

    await assertRejects(() => scanForRemoval(root), Error, "missing from path");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with missing to path", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename from.txt ->   "].join("\n"),
    );

    await assertRejects(() => scanForRemoval(root), Error, "missing to path");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with absolute from path", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename C:/abs/source.txt -> to.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "from path must be relative",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with absolute to path", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename from.txt -> C:/abs/to.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "to path must be relative",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with dot-segment from path", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename dir/./from.txt -> to.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "from path must be a clean relative path",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with dotdot-segment to path", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename from.txt -> dir/../to.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "to path must be a clean relative path",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename with trailing slash path segment", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename from/ -> to.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "from path must be a clean relative path",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects !rename when from and to are identical after normalization", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      ["mods/**", "!rename ./dir\\same.txt -> dir/same.txt"].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "from and to paths are identical",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects duplicate !rename source paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "mods/**",
        "!rename from.txt -> to-1.txt",
        "!rename from.txt -> to-2.txt",
      ].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "duplicate source path",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanForRemoval rejects duplicate !rename target paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(root, KEEPLIST_FILE),
      [
        "mods/**",
        "!rename from-1.txt -> to.txt",
        "!rename from-2.txt -> to.txt",
      ].join("\n"),
    );

    await assertRejects(
      () => scanForRemoval(root),
      Error,
      "duplicate target path",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
