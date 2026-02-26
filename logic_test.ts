import {
  buildScanPlan,
  cleanFolder,
  cleanFolderDetailed,
  getRemovableFiles,
  KEEPLIST_FILE,
  matchesKeepRule,
  readKeeplist,
  scanForRemoval,
  writeKeeplist,
} from "./logic.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

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
