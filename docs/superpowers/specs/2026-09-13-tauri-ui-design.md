# Design: the Tauri interface (piece D)

Date: 2026-09-13 · Status: accepted (autonomous — see the run log)
Program: [ADR 2026-09-12 — cross-platform rewrite](../../adr/2026-09-12-cross-platform-tauri.md)
Follows: [piece C — the Tauri shell](2026-09-13-tauri-shell-design.md)
Target version: 0.6.0

## Goal

Give the Tauri shell the interface the SwiftUI app has, on all three platforms:
drop a screenplay PDF, watch it convert, read it, tune it, send it to a reader.
Piece C proved the plumbing with a deliberately plain window. D is the app.

## The design is already decided, and D must not redecide it

This is the governing constraint, and it is unusual enough to state first.
Screepub has a finished visual identity, in web form, with machine-enforced
pins:

- **`brand/tokens.css` and `brand/tokens.json`** — the palette, the type scale,
  radii and spacing. Seven colours are pinned to `app/Sources/ScreepubApp/Theme.swift`
  by `tests/brand-tokens.test.ts`, which fails if they drift. Every token that
  sets text carries a required contrast pair.
- **`brand/components/`** — twelve self-contained HTML/CSS components, each
  openable in a browser: `drop-well`, `progress`, `result-card`,
  `failure-notice`, `device-table`, `buttons`, `page-frame`, `slugline`,
  `title-block`, `transition-rule`, `shot-frame`, `brad`.

The identity is a **script page**: paper (`#F7F2E6` light, `#1E1C19` dark),
ink, punched-hole shading, and brass (`#E8A33D`) as the single accent in both
modes — the brad that holds a screenplay together, with a full specular →
highlight → shadow → rim ramp so it can be drawn as a physical object rather
than a coloured circle. `alarm` is reserved for errors and, per its own token
note, is **never decoration**. Type is Courier Prime for structure — sluglines,
cues, chrome — and Literata for prose, across a ten-step scale where every size
has a documented job.

**So D invents no palette and no typeface.** The design work that remains is
real but specific: how these pieces compose into screens, what the reader
becomes in a webview, and the words.

## What D designs

### 1. Composition

Five surfaces, from `ContentView.swift` (1,020 lines), `ReaderView.swift`,
`ReaderRail.swift`, `ExportPanel.swift`, `SaveFlow.swift` and
`ReleaseNotesSheet.swift`:

- **Convert** — the drop well, progress, and the result.
- **Read** — the converted script, with its rail.
- **Tune** — the eighteen format options, which already have a registry
  (`docs/formatting-options-log.md`) explaining what each is *for*.
- **Send** — connected readers and the export ladder (KFX → AZW3 → MOBI).
- **Notes** — what changed in this release.

The window should read as a script on a desk, not as a tool with a script
inside it. The brad and the punched holes are the project's own motif and the
page already carries them; the layout's job is to let the paper be the surface
rather than sit inside a chrome frame.

### 2. The reader — the hardest surface, and the one worth the effort

`page-frame`, `slugline`, `title-block`, `transition-rule` and `shot-frame`
exist precisely because a screenplay has typographic furniture that a generic
document viewer destroys. The reader is where Screepub's whole thesis — that a
script should keep its shape — becomes visible. It is the surface to spend
boldness on; everything around it stays quiet.

Two constraints inherited from the engine, both already reasoned about in
`docs/screenplay-format-reference.md` and the formatting registry:

- Reflowed text has no fixed page, so the reader shows the *structure* a script
  carries — scene boundaries, cues, dialogue geometry — not a paper simulation.
- The engine already produces the semantic HTML for a preview
  (`tokensToPreviewHtml`). The reader renders that, so a formatting decision
  cannot disagree between the app and the EPUB a user actually gets.

### 3. The words

Copy is design content here. The registry and the README establish the voice:
plain, specific, explains *why*, and honest about limits. Two places matter
most and are usually where a generated interface gives itself away:

- **Errors say what happened and what to do.** The engine already returns real
  messages (a scanned PDF, a non-screenplay, an unreadable file); the interface
  renders them rather than replacing them with an apology.
- **Empty and waiting states are invitations, not mood.** A window with nothing
  dropped on it yet should say what to do with it.

Verbs stay constant through a flow: the control that says Send produces a
result that says Sent.

## What D explicitly does not do

Bundling and installers (E2). Retiring the SwiftUI app (F). Auto-update.
Anything needing a signing certificate. New device capabilities — the device
layer is piece A's, already ported and tested, and D only calls it.

## Testing

- **`tests/brand-tokens.test.ts` must keep passing untouched.** It is the pin
  that stops the web identity drifting from `Theme.swift` while both exist. If
  a token needs changing, the existing rule applies: change `tokens.json`, not
  the app.
- **The existing component tests stay green** — `tests/brand-components.test.ts`
  already asserts things like never putting `var(--ink)` on a `var(--brass)`
  ground, which is a real contrast failure it caught once.
- **The interface is checked by running it.** Piece C established the app builds
  and launches here, so D's surfaces get looked at in a real window rather than
  reasoned about. Screenshots beat description.
- **No Rust is added.** The shell's two commands are piece C's; if D needs a
  third, that is a design smell worth raising rather than a task to do quietly —
  the ADR's rule is that Rust is a window, not a brain.

## Acceptance criteria

1. All five surfaces exist and work against the real engine on this machine.
2. `tests/brand-tokens.test.ts` and `tests/brand-components.test.ts` pass
   unmodified; the engine suite stays green; `bunx tsc --noEmit` clean.
3. No new Rust command, and `desktop/`'s Rust line count does not grow beyond
   piece C's ceiling.
4. Nothing under `app/` is modified.
5. Every colour and size used comes from `brand/tokens.css`; a review can grep
   for a hard-coded hex and find none.
6. The window is usable at a small size and with the keyboard, and respects
   reduced motion — the quality floor, met without being announced.

## Risks

- **Scope.** `ContentView.swift` alone is 1,020 lines. D is the largest piece in
  the program and the most tempting to gold-plate. The five surfaces are the
  scope; anything else is a later piece.
- **The reader is genuinely hard.** Reflowed screenplay furniture is the
  project's core problem, and the webview is a new rendering surface for it.
- **Two interfaces exist at once** until F. That is intentional, and the token
  pin is what keeps them honest.
- **Only Linux is verifiable here.** macOS and Windows rendering differences —
  fonts especially, since Courier Prime and Literata must be bundled rather
  than assumed — ride on CI and on E2's bundling.
