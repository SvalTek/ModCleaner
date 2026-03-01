import { WebUI } from "WebUI";
import { FileDialog, load as loadNativeDialog } from "@miyauci/rfd/deno";
import {
  buildScanPlan,
  cleanFolderDetailed,
  type CleanMode,
  writeKeeplist,
} from "./logic.ts";

const html = `<!DOCTYPE html>
<html>
<head>
<script src="webui.js"></script>
<meta charset="utf-8" />
<title>ModCleaner</title>
<style>
:root {
  --bg: #16181d;
  --surface: #22262e;
  --surface-2: #1d2128;
  --border: #303641;
  --text: #e8ecf2;
  --muted: #aeb8c7;
  --accent: #3b82f6;
  --accent-hover: #4c8df3;
  --danger: #d65252;
  --danger-hover: #e46969;
  --success-bg: #1f3d2e;
  --success-border: #3f8a63;
  --error-bg: #402727;
  --error-border: #9f4b4b;
  --info-bg: #1e304a;
  --info-border: #3d6ea7;
  --z-results-sticky: 10;
  --z-modal-backdrop: 9998;
  --z-modal: 9999;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: "Segoe UI", "Inter", sans-serif;
  background:
    radial-gradient(circle at 15% -15%, #2b3140 0%, rgba(43, 49, 64, 0) 45%),
    radial-gradient(circle at 95% 0%, #273349 0%, rgba(39, 51, 73, 0) 35%),
    var(--bg);
  color: var(--text);
}
.container {
  width: 760px;
  max-width: calc(100vw - 32px);
  margin: 28px auto;
  padding: 0;
}
.app-header {
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  letter-spacing: 0.2px;
}
.subtitle {
  margin-top: 6px;
  color: var(--muted);
  font-size: 14px;
}
.card {
  background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}
.card + .card {
  margin-top: 14px;
}
.section-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.folder-row {
  display: flex;
  gap: 10px;
}
input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #181b21;
  color: var(--text);
  font-size: 14px;
}
select {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #181b21;
  color: var(--text);
  font-size: 14px;
}
select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}
input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
}
button {
  height: 40px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  padding: 0 14px;
  font-size: 14px;
  font-weight: 600;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
button.primary {
  background: var(--accent);
}
button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
button.secondary {
  background: #2f3643;
  border-color: #404a5c;
}
button.secondary:hover:not(:disabled) {
  background: #3a4252;
}
button.danger {
  background: var(--danger);
  margin-left: auto;
}
button.danger:hover:not(:disabled) {
  background: var(--danger-hover);
}
.actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}
.mode-row {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
}
.mode-help {
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
}
.actions .danger-wrap {
  margin-left: auto;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.status {
  margin-top: 12px;
  border: 1px solid var(--info-border);
  background: var(--info-bg);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.4;
}
.status[data-type="success"] {
  border-color: var(--success-border);
  background: var(--success-bg);
}
.status[data-type="error"] {
  border-color: var(--error-border);
  background: var(--error-bg);
}
.results {
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 420px;
  overflow-y: auto;
  background: #181b21;
}
.results-section + .results-section {
  border-top: 1px solid var(--border);
}
.results-header {
  position: sticky;
  top: 0;
  z-index: var(--z-results-sticky);
  padding: 10px 12px;
  background: #212733;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.results-rows {
  padding: 8px;
}
.result-row {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
  padding: 6px 8px;
  border-radius: 6px;
  color: #d8dfec;
  word-break: break-word;
}
.result-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.03);
}
.result-empty {
  color: var(--muted);
}
.details {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #1b1f26;
}
.details summary {
  cursor: pointer;
  padding: 10px 12px;
  font-weight: 600;
  color: #dce3ef;
}
.details-content {
  padding: 0 12px 12px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #c2cbda;
}
.details-content code {
  color: #f1f5fd;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(7, 10, 16, 0.72);
  backdrop-filter: blur(4px);
}
.modal-backdrop[hidden] {
  display: none;
}
.modal {
  position: relative;
  z-index: var(--z-modal);
  width: min(420px, 100%);
  background: linear-gradient(180deg, #232833 0%, #1a1f28 100%);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.modal-header {
  padding: 14px 16px 0 16px;
}
.modal-title {
  font-size: 18px;
  font-weight: 700;
}
.modal-body {
  padding: 10px 16px 16px 16px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 16px 16px 16px;
}
@media (max-width: 620px) {
  .container {
    margin: 18px auto;
  }
  .folder-row {
    flex-direction: column;
  }
  .actions {
    flex-wrap: wrap;
  }
  .actions .danger-wrap {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
  }
  .actions button {
    flex: 1;
    min-width: 140px;
  }
}
</style>
</head>
<body>
<div class="container">
  <header class="app-header">
    <h1>ModCleaner</h1>
    <div class="subtitle">Scan and clean game folders using <code>#keeplist.txt</code> rules.</div>
  </header>

  <section class="card">
    <label class="section-label" for="gamePath">Game Folder</label>
    <div class="folder-row">
      <input id="gamePath" placeholder="Select a game folder" oninput="markScanDirty()" />
      <button class="secondary" onclick="browseFolder(document.getElementById('gamePath').value || '')">Browse</button>
    </div>

    <div class="actions">
      <button class="secondary" id="generateButton" onclick="generateKeeplist()">Generate Keeplist</button>
      <button class="primary" id="scanButton" onclick="scanFolder()">Scan</button>
      <div class="danger-wrap">
        <button class="danger" id="cleanButton" onclick="cleanFiles()" disabled>Clean</button>
      </div>
    </div>

    <div class="mode-row">
      <label class="section-label" for="cleanMode" style="margin: 0; min-width: 130px;">Clean Mode</label>
      <select id="cleanMode" onchange="updateCleanModeHelp()">
        <option value="delete">Delete (permanent)</option>
        <option value="quarantine">Quarantine (move files)</option>
      </select>
    </div>
    <div class="mode-help" id="cleanModeHelp"></div>

    <div class="status" id="status" data-type="info">Idle</div>

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
        <div><code>Clean</code> can permanently delete files or move them into <code>.modcleaner_quarantine/&lt;timestamp&gt;</code>.</div>
      </div>
    </details>
  </section>

  <section class="card">
    <span class="section-label">Results</span>
    <div class="results" id="fileList"></div>
  </section>
</div>

<div class="modal-backdrop" id="confirmModal" hidden>
  <div class="modal">
    <div class="modal-header">
      <div class="modal-title" id="confirmTitle">Confirm Cleanup</div>
    </div>
    <div class="modal-body" id="confirmMessage"></div>
    <div class="modal-actions">
      <button class="secondary" id="confirmCancelButton" type="button">Cancel</button>
      <button class="danger" id="confirmOkButton" type="button">Clean</button>
    </div>
  </div>
</div>

<script>
let confirmResolver = null;
let cleanReady = false;
let busy = false;

function setStatus(msg, type = "info") {
  document.getElementById("status").innerText = msg;
  document.getElementById("status").setAttribute("data-type", type);
}
function setBusy(isBusy) {
  busy = Boolean(isBusy);
  const ids = ["generateButton", "scanButton", "cleanButton"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = busy || (id === "cleanButton" && !cleanReady);
    }
  });
}

function getSelectedCleanMode() {
  const mode = document.getElementById("cleanMode")?.value;
  return mode === "quarantine" ? "quarantine" : "delete";
}

function updateCleanModeHelp() {
  const mode = getSelectedCleanMode();
  const help = document.getElementById("cleanModeHelp");
  if (!help) {
    return;
  }

  if (mode === "delete") {
    help.innerText = "Warning: Delete mode permanently removes files after confirmation.";
    return;
  }

  help.innerText = "Quarantine mode moves removable files to .modcleaner_quarantine/<timestamp>/ under the selected game folder.";
}
function setCleanReady(isReady) {
  cleanReady = Boolean(isReady);
  setBusy(busy);
}
function markScanDirty() {
  setCleanReady(false);
}
function setResults(data) {
  const el = document.getElementById("fileList");
  const rows = [];

  const removals = data.removals || [];
  const renames = data.renames || [];

  rows.push(\`<div class="results-section">\`);
  rows.push(\`<div class="results-header">Planned Renames (\${renames.length})</div>\`);
  rows.push(\`<div class="results-rows">\`);
  if (renames.length === 0) {
    rows.push(\`<div class="result-row result-empty">No renames planned</div>\`);
  } else {
    rows.push(...renames.map((rename) => \`<div class="result-row">\${rename.from} -> \${rename.to}</div>\`));
  }
  rows.push(\`</div></div>\`);

  rows.push(\`<div class="results-section">\`);
  rows.push(\`<div class="results-header">Files To Remove (\${removals.length})</div>\`);
  rows.push(\`<div class="results-rows">\`);
  if (removals.length === 0) {
    rows.push(\`<div class="result-row result-empty">No files to remove</div>\`);
  } else {
    rows.push(...removals.map((file) => \`<div class="result-row">\${file}</div>\`));
  }
  rows.push(\`</div></div>\`);

  el.innerHTML = rows.join("");
}

function resolveConfirm(result) {
  const modal = document.getElementById("confirmModal");
  modal.hidden = true;

  if (confirmResolver) {
    const resolver = confirmResolver;
    confirmResolver = null;
    resolver(result);
  }
}

function showConfirmDialog(title, message, confirmLabel = "Confirm") {
  const modal = document.getElementById("confirmModal");
  const titleEl = document.getElementById("confirmTitle");
  const messageEl = document.getElementById("confirmMessage");
  const okButton = document.getElementById("confirmOkButton");
  const cancelButton = document.getElementById("confirmCancelButton");

  titleEl.innerText = title;
  messageEl.innerText = message;
  okButton.innerText = confirmLabel;
  modal.hidden = false;
  cancelButton.focus();

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

document.getElementById("confirmCancelButton").addEventListener("click", () => {
  resolveConfirm("false");
});

document.getElementById("confirmOkButton").addEventListener("click", () => {
  resolveConfirm("true");
});

document.getElementById("confirmModal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    resolveConfirm("false");
  }
});

document.addEventListener("keydown", (event) => {
  const modal = document.getElementById("confirmModal");
  if (modal.hidden) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    resolveConfirm("false");
  }
});

setResults({ removals: [], renames: [] });
setCleanReady(false);
updateCleanModeHelp();
</script>
</body>
</html>
`;

function runStatus(
  event: WebUI.Event,
  message: string,
  type: "info" | "success" | "error" = "info",
): void {
  event.window.run(
    `setStatus(${JSON.stringify(message)}, ${JSON.stringify(type)})`,
  );
}

function runBusy(event: WebUI.Event, isBusy: boolean): void {
  event.window.run(`setBusy(${JSON.stringify(isBusy)})`);
}

function runCleanReady(event: WebUI.Event, isReady: boolean): void {
  event.window.run(`setCleanReady(${JSON.stringify(isReady)})`);
}

async function showCleanupConfirmation(event: WebUI.Event): Promise<boolean> {
  const mode = await getCleanMode(event);
  const message = mode === "delete"
    ? "Delete mode permanently removes files that are not covered by #keeplist.txt. Continue?"
    : "Quarantine mode moves removable files to .modcleaner_quarantine/<timestamp>/ inside the selected game folder. Continue?";

  const confirmedValue: unknown = await event.window.script(`
    return showConfirmDialog(
      "Confirm Cleanup",
      ${JSON.stringify(message)},
      "Clean"
    );
  `);

  return confirmedValue === true ||
    (typeof confirmedValue === "string" && confirmedValue === "true");
}

async function getCleanMode(event: WebUI.Event): Promise<CleanMode> {
  const value = await event.window.script(
    "return (document.getElementById('cleanMode')?.value || 'delete');",
  );

  return value === "quarantine" ? "quarantine" : "delete";
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

let lastScannedRoot: string | null = null;

async function browseFolder(event: WebUI.Event): Promise<void> {
  const currentPath = event.arg.string(0).trim();

  try {
    runBusy(event, true);
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
      }; markScanDirty();`,
    );
    lastScannedRoot = null;
    runCleanReady(event, false);
    runStatus(event, "Folder selected", "success");
  } catch (error) {
    runStatus(event, `Failed to open folder picker: ${String(error)}`, "error");
  } finally {
    runBusy(event, false);
  }
}

async function generateKeeplist(event: WebUI.Event): Promise<void> {
  const root = await getRootPath(event);
  if (!root) {
    runStatus(event, "Select a game folder first", "error");
    return;
  }

  try {
    runBusy(event, true);
    const files = await writeKeeplist(root);
    lastScannedRoot = null;
    runCleanReady(event, false);
    runStatus(
      event,
      `#keeplist.txt generated (${files.length} entries)`,
      "success",
    );
  } catch (error) {
    runStatus(event, `Failed to generate keeplist: ${String(error)}`, "error");
  } finally {
    runBusy(event, false);
  }
}

async function scanFolder(event: WebUI.Event): Promise<void> {
  const root = await getRootPath(event);
  if (!root) {
    runStatus(event, "Select a game folder first", "error");
    return;
  }

  try {
    runBusy(event, true);
    const plan = await buildScanPlan(root);
    lastScannedRoot = root;
    runCleanReady(event, true);
    runResults(event, plan.removableFiles, plan.plannedRenames);
    runStatus(
      event,
      `Scan complete. Review planned renames and removals, then confirm Clean to apply this plan.`,
      "info",
    );
  } catch (error) {
    lastScannedRoot = null;
    runCleanReady(event, false);
    runStatus(event, `Failed to scan folder: ${String(error)}`, "error");
  } finally {
    runBusy(event, false);
  }
}

async function cleanFiles(event: WebUI.Event): Promise<void> {
  const root = await getRootPath(event);
  if (!root) {
    runStatus(event, "Select a game folder first", "error");
    return;
  }

  if (lastScannedRoot !== root) {
    runCleanReady(event, false);
    runStatus(
      event,
      "Run Scan first for the current folder, then review the results before cleaning.",
      "error",
    );
    return;
  }

  const confirmed = await showCleanupConfirmation(event);
  if (!confirmed) {
    runStatus(event, "Cleanup cancelled", "info");
    return;
  }

  const mode = await getCleanMode(event);

  try {
    runBusy(event, true);
    const result = await cleanFolderDetailed(root, { mode });
    const appliedRenames = result.renameResults.filter((rename) =>
      rename.applied
    )
      .length;
    const missingSourceRenames = result.renameResults.filter((rename) =>
      rename.reason === "missing_source"
    ).length;
    const targetExistsRenames = result.renameResults.filter((rename) =>
      rename.reason === "target_exists"
    ).length;
    runResults(
      event,
      result.removedFiles,
      result.renameResults.map((rename) => ({
        from: rename.from,
        to: rename.to,
      })),
    );
    const modeSummary = result.mode === "quarantine" && result.quarantineRunId
      ? `quarantined at .modcleaner_quarantine/${result.quarantineRunId}`
      : "deleted permanently";
    runStatus(
      event,
      `Cleanup complete (${result.removedFiles.length} file(s) ${modeSummary}, renames: ${appliedRenames} applied, ${missingSourceRenames} missing source, ${targetExistsRenames} target exists)`,
      "success",
    );
  } catch (error) {
    runStatus(event, `Failed to clean folder: ${String(error)}`, "error");
  } finally {
    lastScannedRoot = null;
    runCleanReady(event, false);
    runBusy(event, false);
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
