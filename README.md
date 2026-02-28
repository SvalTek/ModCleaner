<div style="display:flex; align-items:center; gap:24px; margin-bottom:24px;">
  <img src="assets/ModCleaner-medium.png" width="180">
  <h1 style="margin:0;">ModCleaner</h1>
</div>
<br />

ModCleaner is a small desktop utility for cleaning a game folder with a simple keep-list.

It works by comparing the current contents of a game directory against a `#keeplist.txt` file. Anything not covered by the keeplist is treated as removable. This makes it useful for returning a heavily modded game install to a known-good state without manually sorting through every file.

## What It Does

ModCleaner provides three main actions:

- `Generate Keeplist`
- `Scan`
- `Clean`

### Generate Keeplist

Creates or overwrites `#keeplist.txt` inside the selected game folder.

The generated file contains the current folder contents as relative paths. In other words, it takes a snapshot of what exists right now and treats those paths as files to preserve later.

### Scan

Reads `#keeplist.txt`, evaluates the keep rules, and shows:

- planned file removals
- planned rename operations

`Scan` is non-destructive. It does not delete, move, or rename anything.

### Clean

Applies the current cleanup plan:

- deletes files not covered by the keeplist
- applies any valid `!rename` directives
- removes empty parent directories left behind by deleted files

`Clean` is destructive. Deleted files are not moved to a recycle bin.

## Intended Workflow

1. Select your game folder.
2. Run `Generate Keeplist` to capture the current files.
3. Edit `#keeplist.txt` if needed.
4. Run `Scan` to review what would happen.
5. Run `Clean` only after confirming the scan output.

A common pattern is:

- generate a keeplist from a known-good setup
- later install mods or make changes
- run `Scan` and `Clean` to remove anything not in the keeplist

## Important Behavior

This tool is snapshot-based.

That means if you install new mods or add files after generating `#keeplist.txt`, those new files are not automatically preserved. If you want to keep them, you must either:

- regenerate the keeplist, or
- add keep rules manually

Also:

- `#keeplist.txt` is never deleted by the cleaner
- `Scan` requires a valid `#keeplist.txt`
- `Clean` requires a valid `#keeplist.txt`
- an empty keeplist is treated as an error
- file ordering and planning are deterministic

## Keeplist Format

`#keeplist.txt` is line-based.

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

There is no rollback for partial progress during `Clean`. (This is why `Scan` is important to review beforehand. This may be improved in the future.)

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

This tool permanently deletes files that are not matched by the keeplist. It is best used when:

- you understand the folder you are targeting
- you have a backup or can re-verify game files if needed
- you have reviewed `#keeplist.txt`

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

If a file is not covered by `#keeplist.txt`, it is removable.
