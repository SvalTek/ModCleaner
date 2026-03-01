<div style="display:flex; align-items:center; gap:24px; margin-bottom:24px;">
  <img src="assets/ModCleaner-medium.png" width="180">
  <h1 style="margin:0;">ModCleaner</h1>
</div>
<br />

ModCleaner is a small desktop utility for cleaning a game folder with a simple keep-list.

It works by comparing the current contents of a game directory against the active keeplist file. By default that file is `#keeplist.txt`. If a keeplist prefix is active, the file becomes `#<prefix>-keeplist.txt`. Anything not covered by the active keeplist is treated as removable. This makes it useful for returning a heavily modded game install to a known-good state without manually sorting through every file.

## What It Does

ModCleaner provides three main actions:

- `Generate Keeplist`
- `Scan`
- `Clean`

### Generate Keeplist

Creates or overwrites the active keeplist inside the selected game folder.

The generated file contains the current folder contents as relative paths. In other words, it takes a snapshot of what exists right now and treats those paths as files to preserve later.

> [!IMPORTANT]
> `Generate Keeplist` overwrites the active keeplist file. If you maintain manual keep rules or `!rename` directives, keep a copy or re-add them after generating.

### Scan

Reads the active keeplist, evaluates the keep rules, and shows:

- planned file removals
- planned rename operations

`Scan` is non-destructive. It does not delete, move, or rename anything.

### Clean

Applies the current cleanup plan:

- removes files not covered by the keeplist
- applies any valid `!rename` directives
- removes empty parent directories left behind by removed files

`Clean` supports two modes:

- `Delete` permanently removes files
- `Quarantine` moves files into `.modcleaner_quarantine/<timestamp>/` inside the selected game folder

Neither mode uses the OS recycle bin.

> [!WARNING]
> `Delete` permanently removes files. `Quarantine` is safer because it moves removable files into `.modcleaner_quarantine/<timestamp>/`, but it is not a full rollback system.

## Intended Workflow

1. Select your game folder.
2. Run `Generate Keeplist` to capture the current files.
3. Edit the active keeplist if needed.
4. Run `Scan` to review what would happen.
5. Run `Clean` only after confirming the scan output.

A common pattern is:

- generate a keeplist from a known-good setup
- later install mods or make changes
- run `Scan` and `Clean` to remove anything not in the keeplist

## Important Behavior

This tool is snapshot-based.

> [!IMPORTANT]
> If you add mods or other files after generating the active keeplist, those files are not automatically preserved. Regenerate the keeplist or add keep rules manually before cleaning.

If you want to keep them, you must either:

- regenerate the keeplist, or
- add keep rules manually

Also:

- keeplist files matching `#keeplist.txt` or `#<prefix>-keeplist.txt` are never deleted by the cleaner.
- `Scan` requires a valid active keeplist
- `Clean` requires a valid active keeplist
- an empty keeplist is treated as an error
- file ordering and planning are deterministic

### Keeplist Prefixes

ModCleaner supports an optional in-memory keeplist prefix system.

- default keeplist: `#keeplist.txt`
- prefixed keeplist: `#<prefix>-keeplist.txt`

The prefix UI is intentionally hidden behind `Ctrl+K`. This is to avoid confusion for users who just want a single keeplist file.
If you want to use prefixes, press `Ctrl+K` and enter a prefix to switch to a different keeplist file. You can have as many keeplist files as you want, but only one is active at a time.

> [!NOTE]
> Keeplist prefixes are an advanced feature. They do not add extra scanning behavior; they only change which keeplist filename `Generate`, `Scan`, and `Clean` use.

Rules:

- prefixes are stored in memory only
- an empty prefix returns to `#keeplist.txt`
- valid prefixes may contain only letters, numbers, `_`, and `-`
- invalid prefixes are rejected and do not change the active keeplist

## Keeplist Format

The active keeplist is line-based.

Blank lines are ignored.

Lines that begin with `# `, meaning hash followed by a space, are comments.

Lines that begin with `#` but not `# ` are treated as literal keep rules. This is intentional so files whose names start with `#` can still be matched.

The top section of the keeplist is auto-generated. You may edit below it.

### Keep Rules

Keep rules use relative paths and glob-style matching.

Supported patterns:

- `*` matches within one path segment
- `**` matches across directories
- a trailing `/` is treated as recursive `/**`

Examples:

```txt
BepInEx/plugins/*.dll
mods/**
profiles/
```

These mean:

- keep DLLs directly inside `BepInEx/plugins`
- keep everything under `mods`
- keep everything under `profiles`

Path normalization rules:

- backslashes are converted to `/`
- a leading `./` is removed
- a trailing `/` becomes `/**`

## Rename Directives

The keeplist also supports literal rename directives:

```txt
!rename Game/Binaries/Win64/exchndl-original.dll -> Game/Binaries/Win64/exchndl.dll
```

This is useful for restore-style cleanup, such as bringing back an original file after removing a modded replacement.

### Rename Rules

Rename directives must follow these rules:

- both paths must be relative
- wildcards are not allowed
- empty path segments are not allowed
- `.` and `..` segments are not allowed
- source and target cannot be identical
- duplicate `from` paths are rejected
- duplicate `to` paths are rejected

These rules are enforced during `Scan` and `Clean`.

### Rename Outcomes

A rename can end in one of these states:

- `applied`
- `missing_source`
- `target_exists`

`missing_source` and `target_exists` are reported but are not treated as fatal errors.

Other rename I/O failures are fatal.

There is no automatic rollback for partial progress during `Clean`.

In `Delete` mode, removed files are gone unless you have your own backup or can restore them another way.

In `Quarantine` mode, removed files are moved into `.modcleaner_quarantine/<timestamp>/`, which gives you a manual recovery path, but rename operations and other partial-progress cases are still not rolled back automatically.

## Example Keeplist

```txt
# Keep core mod framework files
BepInEx/core/**
BepInEx/plugins/*.dll
mods/**

# Restore a vanilla DLL if the modded target has been removed
!rename Game/Binaries/Win64/exchndl-original.dll -> Game/Binaries/Win64/exchndl.dll
```

## Safety Notes

Review the scan output before cleaning.

> [!WARNING]
> `Scan` is the review step. `Clean` applies the current plan and does not provide automatic rollback for partial progress.

This tool can permanently delete files that are not matched by the keeplist. It is best used when:

- you understand the folder you are targeting
- you have a backup, can re-verify game files, or are intentionally using quarantine mode
- you have reviewed the active keeplist

## Development

This project is built with Deno.

Available tasks:

```sh
deno task dev
deno task test
deno task build
```

## Project Structure

- `main.ts` - desktop UI and command orchestration
- `logic.ts` - keeplist parsing, scan planning, cleanup, rename behavior
- `logic_test.ts` - behavioral tests for core logic

## Current Platform Notes

The project is packaged as a desktop app for Windows. A Linux build has been provided and due to the way the logic is structured, it should work on Linux as well. (Untested)
A macOS build is not currently planned though it may run fine if built from source.

## Summary

ModCleaner is a deterministic keep-list cleaner for game folders.

It does not try to detect which files are mods automatically. Instead, it gives you a simple rule:

If a file is not covered by the active keeplist, it is removable.
