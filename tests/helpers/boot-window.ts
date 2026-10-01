// Boots the whole window the way index.html does: imports desktop/ui/main.js
// against the fake DOM and a stand-in Tauri, so a test can press keys, drop
// files and click tabs on the real frame with the real surfaces mounted in it.
//
// Each boot imports its own COPY of desktop/ui's scripts, from a folder
// under the caller's scratch folder. main.js hangs handlers on app.js
// (onDialogClosed) and on the update flow that nothing can take off again;
// on the shared modules they would outlive the page and fire into every
// later test file's dialogs. On a copy, nothing else ever reaches them.
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fakePage, settle, type FakeNode, type FakePage } from './fake-dom';

const UI = join(import.meta.dir, '..', '..', 'desktop', 'ui');

export interface BootedWindow extends FakePage {
  /** The pane a surface is mounted in. */
  surface(id: string): FakeNode;
  tab(id: string): FakeNode;
  /** The id of the surface whose pane is showing. */
  showing(): string | null;
  /** A key pressed with nothing in particular focused: the window hears it. */
  press(key: string, mods?: { metaKey?: boolean; ctrlKey?: boolean }): ReturnType<FakePage['fireWindow']>;
  /** The folder this boot's copy of the scripts was imported from. */
  ui: string;
}

/** `scratch` is the calling test file's own scratch folder; the copy is
 *  made inside it, so it goes when that folder does. */
export async function bootWindow(
  scratch: string,
  options: Parameters<typeof fakePage>[0] = {},
): Promise<BootedWindow> {
  const ui = mkdtempSync(join(scratch, 'ui-'));
  for (const name of readdirSync(UI)) {
    if (name.endsWith('.js')) copyFileSync(join(UI, name), join(ui, name));
  }
  const page = fakePage(options);
  const root = page.doc.createElement('div');
  root.id = 'app';
  page.doc.body.append(root);
  await import(join(ui, 'main.js'));
  await settle();
  return {
    ...page,
    ui,
    surface: (id) => page.doc.getElementById(`surface-${id}`)!,
    tab: (id) => page.doc.getElementById(`tab-${id}`)!,
    showing() {
      const on = page.doc.querySelectorAll('section.surface').find((p) => !p.hidden);
      return on === undefined ? null : on.id.replace(/^surface-/, '');
    },
    press(key, mods = {}) {
      return page.fireWindow('keydown', { key, metaKey: false, ctrlKey: false, ...mods });
    },
  };
}
