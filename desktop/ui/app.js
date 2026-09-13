// The window's whole share of the work: build an argv, hand it to Rust,
// parse what comes back, render it.
//
// The Rust does not know these flags and must not learn them. `--json` is
// this file's responsibility, and so is deciding what the answer means.
// See ADR 2026-09-12: Rust is a window, not a brain.

const invoke = window.__TAURI__.core.invoke;

const engineLine = document.getElementById('engine');
const convertButton = document.getElementById('convert');
const resultBox = document.getElementById('result');
const failureBox = document.getElementById('failure');

/** Run the engine and parse its one line of stdout.
 *  Throws an Error whose message is fit to show a person. */
async function engine(args) {
  let stdout;
  try {
    stdout = await invoke('run_engine', { args });
  } catch (message) {
    // Rust rejected: it could not find or start the binary at all.
    throw new Error(String(message));
  }
  try {
    return JSON.parse(stdout);
  } catch {
    // The engine printed something that is not its contract. Show it raw
    // rather than swallowing it — this is how a dropped --json presents.
    throw new Error(`the engine did not answer in JSON:\n${stdout}`);
  }
}

function show(box, html) {
  box.innerHTML = html;
  box.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

async function showEngineVersion() {
  try {
    const answer = await engine(['--version', '--json']);
    engineLine.textContent = `engine ${answer.version}`;
  } catch (err) {
    engineLine.textContent = err.message;
    engineLine.classList.add('bad');
  }
}

async function convert() {
  resultBox.hidden = true;
  failureBox.hidden = true;

  const path = await invoke('pick_file');
  if (!path) return; // cancelled

  convertButton.disabled = true;
  convertButton.textContent = 'Converting…';
  try {
    const answer = await engine([path, '--json']);
    if (answer.ok) {
      // Only the engine's own numbers. Nothing is computed here.
      show(
        resultBox,
        `<h2>${escapeHtml(answer.title)}</h2>` +
          (answer.author ? `<p>${escapeHtml(answer.author)}</p>` : '') +
          `<p>${escapeHtml(answer.pages)} pages · ${escapeHtml(answer.scenes)} scenes · ` +
          `${escapeHtml(answer.characters)} speaking characters</p>` +
          `<p class="path">${escapeHtml(answer.epubPath)}</p>` +
          (answer.warnings ?? [])
            .map((w) => `<p class="warning">${escapeHtml(w)}</p>`)
            .join(''),
      );
    } else {
      // The engine's own message, verbatim. Not reworded, not re-classified.
      show(
        failureBox,
        `<p class="bad">${escapeHtml(answer.error.message)}</p>` +
          `<p class="muted">${escapeHtml(answer.error.code)}</p>`,
      );
    }
  } catch (err) {
    show(failureBox, `<pre class="bad">${escapeHtml(err.message)}</pre>`);
  } finally {
    convertButton.disabled = false;
    convertButton.textContent = 'Choose a screenplay…';
  }
}

convertButton.addEventListener('click', convert);
showEngineVersion();
