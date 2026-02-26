import { WebUI } from "WebUI";
import { FileDialog, load as loadNativeDialog } from "@miyauci/rfd/deno";
import { buildScanPlan, cleanFolderDetailed, writeKeeplist } from "./logic.ts";

const html = `<!DOCTYPE html>
<html>
<head>
<script src="webui.js"></script>
<meta charset="utf-8" />
<title>ModCleaner</title>
<style>
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1e1f22;
  color: #e6e6e6;
}
.container {
  width: 400px;
  max-width: calc(100vw - 32px);
  margin: 40px auto;
  padding: 20px;
}
h1 { margin-bottom: 20px; }
.details {
  margin-bottom: 14px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #23252a;
}
.details summary {
  cursor: pointer;
  padding: 10px 12px;
  font-weight: 600;
}
.details-content {
  padding: 0 12px 12px 12px;
  font-size: 12px;
  line-height: 1.45;
  color: #d0d0d0;
}
.details-content code {
  color: #ffffff;
}
.folder-row { display: flex; gap: 10px; }
input {
  flex: 1;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #444;
  background: #2a2c30;
  color: white;
}
button {
  background: #2f81f7;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  color: white;
  cursor: pointer;
}
button.danger { background: #d64545; }
.actions { margin-top: 15px; display: flex; gap: 10px; }
.status { margin-top: 15px; font-size: 14px; opacity: 0.9; }
.results {
  margin-top: 20px;
  background: #2a2c30;
  border-radius: 6px;
  padding: 10px;
  max-height: 400px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 13px;
}
</style>
</head>
<body>
<div class="container">
  <h1>ModCleaner</h1>
  <details class="details">
    <summary>How It Works</summary>
    <div class="details-content">
      <div>This tool uses a snapshot-style keep system.</div>
      <div>Only files matching <code>#keeplist.txt</code> rules are preserved.</div>
      <div>If you install new mods or add files you want to keep, update <code>#keeplist.txt</code> first.</div>
      <div>You can do that by running <code>Generate Keeplist</code> again or adding wildcard rules manually.</div>
      <hr />
      <div><code>Generate Keeplist</code> writes <code>#keeplist.txt</code> into the selected game folder.</div>
      <div>Each line is a keep rule. Files matching any rule are preserved.</div>
      <div>Supported patterns:</div>
      <div><code>*</code> matches within one path segment. Example: <code>BepInEx/plugins/*.dll</code></div>
      <div><code>**</code> matches across nested folders. Example: <code>mods/**</code></div>
      <div>Trailing slash is treated as recursive. Example: <code>mods/</code> equals <code>mods/**</code></div>
      <div><code>#keeplist.txt</code> is overwritten each time you generate. Add manual wildcard rules after generating if needed.</div>
      <div>Every non-empty line is treated as a rule. Lines starting with <code># </code> are comments. Blank lines are ignored.</div>
      <div>Literal rename directives are supported: <code>!rename Game/Binaries/Win64/exchndl-original.dll -> Game/Binaries/Win64/exchndl.dll</code></div>
      <div><code>!rename</code> paths are relative-only and do not support wildcards.</div>
      <hr />
      <div><code>Scan</code> checks the folder against <code>#keeplist.txt</code> and lists files that would be removed.</div>
      <div><code>Scan</code> and <code>Clean</code> require <code>#keeplist.txt</code> to exist and contain at least one rule.</div>
      <div><code>Clean</code> permanently deletes files not matching any keep rule. Use with caution.</div>
    </div>
  </details>

  <div class="folder-row">
    <input id="gamePath" placeholder="Select a game folder" />
    <button onclick="browseFolder(document.getElementById('gamePath').value || '')">Browse</button>
  </div>

  <div class="actions">
    <button onclick="generateKeeplist()">Generate Keeplist</button>
    <button onclick="scanFolder()">Scan</button>
    <button class="danger" onclick="cleanFiles()">Clean</button>
  </div>

  <div class="status" id="status">Idle</div>

  <div class="results" id="fileList"></div>
</div>

<script>
function setStatus(msg) {
  document.getElementById("status").innerText = msg;
}
function setResults(data) {
  const el = document.getElementById("fileList");
  const rows = [];

  const removals = data.removals || [];
  const renames = data.renames || [];

  rows.push(\`<div><strong>Files To Remove (\${removals.length})</strong></div>\`);
  if (removals.length === 0) {
    rows.push(\`<div>- none</div>\`);
  } else {
    rows.push(...removals.map((file) => \`<div>- \${file}</div>\`));
  }

  rows.push(\`<div style="margin-top:8px;"><strong>Planned Renames (\${renames.length})</strong></div>\`);
  if (renames.length === 0) {
    rows.push(\`<div>- none</div>\`);
  } else {
    rows.push(...renames.map((rename) => \`<div>- \${rename.from} -> \${rename.to}</div>\`));
  }

  el.innerHTML = rows.join("");
}
</script>
</body>
</html>
`;

function runStatus(event: WebUI.Event, message: string): void {
  event.window.run(`setStatus(${JSON.stringify(message)})`);
}

function runResults(
  event: WebUI.Event,
  removals: string[],
  renames: Array<{ from: string; to: string }>,
): void {
  event.window.run(`setResults(${JSON.stringify({ removals, renames })})`);
}

async function getRootPath(event: WebUI.Event): Promise<string> {
  const value = await event.window.script(
    "return (document.getElementById('gamePath').value || '').trim();",
  );

  if (typeof value !== "string") {
    return "";
  }

  return value;
}

async function browseFolder(event: WebUI.Event): Promise<void> {
  const currentPath = event.arg.string(0).trim();

  try {
    const dialog = new FileDialog();
    if (currentPath) {
      dialog.setDirectory(currentPath);
    }

    const selectedPath = await Promise.resolve(dialog.pickFolder());
    if (!selectedPath) {
      runStatus(event, "Folder selection cancelled");
      return;
    }

    event.window.run(
      `document.getElementById('gamePath').value = ${
        JSON.stringify(selectedPath)
      };`,
    );
    runStatus(event, "Folder selected");
  } catch (error) {
    runStatus(event, `Failed to open folder picker: ${String(error)}`);
  }
}

async function generateKeeplist(event: WebUI.Event): Promise<void> {
  const root = await getRootPath(event);
  if (!root) {
    runStatus(event, "Select a game folder first");
    return;
  }

  try {
    const files = await writeKeeplist(root);
    runStatus(event, `#keeplist.txt generated (${files.length} entries)`);
  } catch (error) {
    runStatus(event, `Failed to generate keeplist: ${String(error)}`);
  }
}

async function scanFolder(event: WebUI.Event): Promise<void> {
  const root = await getRootPath(event);
  if (!root) {
    runStatus(event, "Select a game folder first");
    return;
  }

  try {
    const plan = await buildScanPlan(root);
    runResults(event, plan.removableFiles, plan.plannedRenames);
    runStatus(
      event,
      `${plan.removableFiles.length} file(s) ready for removal, ${plan.plannedRenames.length} rename(s) planned`,
    );
  } catch (error) {
    runStatus(event, `Failed to scan folder: ${String(error)}`);
  }
}

async function cleanFiles(event: WebUI.Event): Promise<void> {
  const root = await getRootPath(event);
  if (!root) {
    runStatus(event, "Select a game folder first");
    return;
  }

  const confirmed = await event.window.script(
    "return confirm('This will permanently delete files. Continue?');",
  );
  if (!confirmed) {
    runStatus(event, "Cleanup cancelled");
    return;
  }

  try {
    const result = await cleanFolderDetailed(root);
    const appliedRenames = result.renameResults.filter((rename) =>
      rename.applied
    ).length;
    runResults(
      event,
      result.removedFiles,
      result.renameResults.map((rename) => ({
        from: rename.from,
        to: rename.to,
      })),
    );
    runStatus(
      event,
      `Cleanup complete (${result.removedFiles.length} file(s) removed, ${appliedRenames} file(s) renamed)`,
    );
  } catch (error) {
    runStatus(event, `Failed to clean folder: ${String(error)}`);
  }
}

const win = new WebUI();

await loadNativeDialog();

win.bind("browseFolder", browseFolder);
win.bind("generateKeeplist", generateKeeplist);
win.bind("scanFolder", scanFolder);
win.bind("cleanFiles", cleanFiles);

await win.showBrowser(html, WebUI.Browser.AnyBrowser);
await WebUI.wait();
