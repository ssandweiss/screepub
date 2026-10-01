// Boots the whole window the way index.html does: imports desktop/ui/main.js
// against the fake DOM and a stand-in Tauri, so a test can press keys, drop
// files and click tabs on the real frame with the real surfaces mounted in it.
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
}

let boots = 0;

/** main.js is imported under a fresh URL each time, so its own top level
 *  runs again; the modules it imports (app.js, the surfaces) are the shared
 *  instances every other test uses, mounted again into this page. */
export async function bootWindow(options: Parameters<typeof fakePage>[0] = {}): Promise<BootedWindow> {
  const page = fakePage(options);
  const root = page.doc.createElement('div');
  root.id = 'app';
  page.doc.body.append(root);
  boots += 1;
  await import(`${join(UI, 'main.js')}?boot-${boots}`);
  await settle();
  return {
    ...page,
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
