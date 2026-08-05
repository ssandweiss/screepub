#!/usr/bin/env python3
"""Generate the public-safe test fixtures in tests/fixtures/.

    make-fixture.py screenplay tests/fixtures/screenplay.pdf
    make-fixture.py prose      tests/fixtures/prose.pdf
    make-fixture.py blank      tests/fixtures/blank-pages.pdf

Real scripts are confidential, so the committed fixtures are invented. The
three kinds cover the three paths convert.ts can take: a screenplay that
converts, a document that trips the not-a-screenplay guard, and pages with
no text layer that trip the scanned guard.

Geometry from docs/screenplay-format-reference.md — 12pt Courier, 10 chars
per inch, 6 lines per inch. Indents matter: Screepub classifies elements by
horizontal position, so a demo PDF with sloppy geometry would parse wrong
and prove nothing.
"""
import re
import textwrap

PT = 72.0
PAGE_W, PAGE_H = 8.5 * PT, 11 * PT
LINE = 12.0                    # 6 lines/inch
TOP = PAGE_H - 1.0 * PT        # 1" top margin
BOTTOM = 1.0 * PT
LINES_PER_PAGE = 55

# Base-14 Type1 fonts, so nothing is embedded and the generator stays a
# pure string builder. Verified against pdf.js: it reports these PostScript
# names through commonObjs, which is what src/parser/extract.ts regexes for
# /bold|black|heavy/ and /italic|oblique/.
FONTS = {"F1": "Courier", "F2": "Courier-Bold",
         "F3": "Courier-Oblique", "F4": "Courier-BoldOblique",
         "F5": "Helvetica"}

CHAR_W = 7.2                   # 12pt Courier advance: 0.1" at 10 chars/inch

X = {                          # inches from left edge
    "scene":  1.5, "action": 1.5, "dialogue": 2.5,
    # Transitions are RIGHT-flush in a real script, and the classifier keys on
    # that: TRANSITION_MIN is indent 55, so a left-flush "CUT TO:" is action,
    # not a transition. At 1.5" neither fixture had ever produced a single
    # transition element while appearing to contain four.
    "paren":  3.1, "character": 3.7, "trans": 6.0, "pgnum": 7.4,
    "mini":   1.5,
}
WRAP = {"scene": 60, "action": 60, "dialogue": 35, "paren": 24,
        "trans": 60, "character": 38,   # cues never wrap in practice
        "mini": 60}

# (type, text) — blank string means a blank line
S = [
    ("scene", "INT. THE LAST VIDEO STORE - NIGHT"),
    ("action", "Fluorescent light hums over aisles of VHS tapes. Rain "
               "streaks the front window. A hand-lettered sign reads: "
               "EVERYTHING MUST GO."),
    ("action", "MARGO SHAW, 60s, cardigan with a pen through the pocket, "
               "alphabetizes a shelf that nobody will browse."),
    ("action", "The bell over the door RINGS."),
    ("character", "MARGO"),
    ("dialogue", "We close at ten."),
    ("character", "DEV"),
    ("paren", "(O.S.)"),
    ("dialogue", "It's nine forty."),
    ("action", "DEV OKONKWO, 20s, soaked through, shakes off a jacket that "
               "was never waterproof."),
    ("character", "MARGO"),
    ("dialogue", "And yet."),
    ("character", "DEV"),
    ("dialogue", "I need something for a fourteen-year-old who thinks "
                 "movies started with streaming."),
    ("action", "Margo looks up for the first time."),
    ("character", "MARGO"),
    ("paren", "(a small conversion)"),
    ("dialogue", "Sit down."),
    ("trans", "CUT TO:"),
    ("scene", "INT. THE LAST VIDEO STORE - HORROR AISLE - CONTINUOUS"),
    ("action", "Margo moves like she's done this ten thousand times, "
               "because she has. Dev trails her, dripping."),
    ("character", "MARGO"),
    ("dialogue", "Fourteen. Scared, or pretending not to be?"),
    ("character", "DEV"),
    ("dialogue", "Pretending. Loudly."),
    ("character", "MARGO"),
    ("dialogue", "Then not the one with the mask. Everyone starts with the "
                 "mask and nobody remembers it."),
    ("action", "She pulls a battered clamshell case and holds it like "
               "evidence."),
    ("character", "MARGO (CONT'D)"),
    ("dialogue", "This one. Nothing happens for forty minutes and then you "
                 "never sleep facing a closet again."),
    ("character", "DEV"),
    ("dialogue", "That's a pitch?"),
    ("character", "MARGO"),
    ("dialogue", "That's a promise."),
    ("trans", "DISSOLVE TO:"),
    ("scene", "EXT. STRIP MALL - NIGHT"),
    ("action", "Rain. The store's neon sign flickers between LAST and AST. "
               "Behind the glass, two silhouettes argue happily about "
               "something that doesn't matter."),
    ("character", "DEV"),
    ("paren", "(O.S.)"),
    ("dialogue", "How long have you been here?"),
    ("character", "MARGO"),
    ("paren", "(O.S.)"),
    ("dialogue", "Since people still rewound."),
    ("scene", "INT. THE LAST VIDEO STORE - COUNTER - LATER"),
    ("action", "A shoebox of index cards. Margo writes on one in careful "
               "block letters and slides it across."),
    ("character", "DEV"),
    ("dialogue", "What's this?"),
    ("character", "MARGO"),
    ("dialogue", "Your card. Nineteen years running, four hundred and six "
                 "members. You're four hundred and seven."),
    ("character", "DEV"),
    ("dialogue", "You're closing in a week."),
    ("character", "MARGO"),
    ("dialogue", "Then it'll be a short membership."),
    ("action", "Dev takes the card anyway. Pockets it like it matters, "
               "because it does."),
    ("character", "DEV"),
    ("dialogue", "What happens to all of it?"),
    ("action", "Margo looks down the aisles. Twenty thousand tapes. A "
               "lifetime of other people's Friday nights."),
    ("character", "MARGO"),
    ("dialogue", "Somebody buys the shelves. The rest goes where the rest "
                 "goes."),
    ("character", "DEV"),
    ("dialogue", "That's grim."),
    ("character", "MARGO"),
    ("paren", "(not grim at all)"),
    ("dialogue", "It's Tuesday."),
    ("trans", "SMASH CUT TO:"),
    ("scene", "INT. DEV'S APARTMENT - NIGHT"),
    ("action", "A television old enough to have a dial. Dev threads the "
               "tape in. Static, then a countdown leader — 5, 4, 3."),
    ("action", "His NIECE, 14, arms folded, sits as far from the screen as "
               "the room allows."),
    ("character", "NIECE"),
    ("dialogue", "This is going to be so boring."),
    ("character", "DEV"),
    ("dialogue", "Forty minutes. Give it forty minutes."),
    ("action", "The countdown hits 1. The room goes dark blue."),
    ("action", "Forty minutes later, she has not moved, and she is sitting "
               "considerably closer."),
    ("trans", "FADE OUT."),
]

TITLE = [
    (4.0, "THE LAST VIDEO STORE"),
    (4.5, "Written by"),
    (5.0, "A. N. Placeholder"),
]


ASCII_MAP = str.maketrans({"—": "--", "–": "-", "’": "'",
                           "‘": "'", "“": '"', "”": '"', "…": "..."})


def esc(s):
    # Courier screenplays use -- and straight quotes by convention, and
    # latin-1 (the PDF string encoding here) has no em dash anyway.
    s = s.translate(ASCII_MAP)
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


# --- inline markup, for the torture kind ---------------------------------

# b/i are font STYLES; u/k/r/w are DRAWN rules (one real, three decoys);
# f/t/z/g are block font SHIFTS, which registry 18 reads back out of the PDF.
MARKUP = re.compile(r"\{(/?)([biukrwftzg])\}")


def parse_markup(s):
    """'a {b}bold{/b} c' -> ('a bold c', [(2, 6, 'b')]).

    Offsets index the PLAIN text, so wrapping can slice by character and
    re-derive styles without ever seeing a marker. Unbalanced markers raise:
    a typo buried in 14 sheets of content must fail at generation rather
    than produce a fixture that quietly tests nothing.
    """
    plain, spans, open_at, pos, out_len = [], [], {}, 0, 0
    for m in MARKUP.finditer(s):
        plain.append(s[pos:m.start()])
        out_len += m.start() - pos
        closing, style = m.group(1), m.group(2)
        if closing:
            if style not in open_at:
                raise ValueError(f"unmatched {{/{style}}} in {s!r}")
            spans.append((open_at.pop(style), out_len, style))
        else:
            if style in open_at:
                raise ValueError(f"nested {{{style}}} in {s!r}")
            open_at[style] = out_len
        pos = m.end()
    plain.append(s[pos:])
    if open_at:
        raise ValueError(f"unclosed {sorted(open_at)} in {s!r}")
    return "".join(plain), spans


def _words(plain):
    """[(start, end)] for each space-delimited word, as offsets into plain."""
    out, i, n = [], 0, len(plain)
    while i < n:
        while i < n and plain[i] == " ":
            i += 1
        if i >= n:
            break
        j = i
        while j < n and plain[j] != " ":
            j += 1
        out.append((i, j))
        i = j
    return out


def _runs(plain, spans, start, end):
    """Slice [start, end) into styled runs, merging equal-styled neighbours."""
    runs = []
    for i in range(start, end):
        st = sorted(s for (a, b, s) in spans if a <= i < b)
        if runs and runs[-1][0] == st:
            runs[-1][1] += plain[i]
        else:
            runs.append([st, plain[i]])
    return [{"styles": st, "text": txt} for st, txt in runs]


def wrap_spans(plain, spans, width):
    """Greedy word wrap that keeps style spans intact across line breaks.

    -> list of lines, each a list of {styles, text} runs.

    Deliberately NOT textwrap. textwrap takes a plain string, so markup has
    to be either stripped (losing the styles) or left in (counting marker
    characters as text width, and splitting a marker across a line). The
    three original fixture kinds keep calling textwrap, untouched, which is
    what lets the byte-stability guard stay meaningful.
    """
    words = _words(plain)
    if not words:
        return [[{"styles": [], "text": ""}]]
    lines = []
    line_start, line_end = words[0]
    for ws, we in words[1:]:
        if we - line_start <= width:
            line_end = we
        else:
            lines.append(_runs(plain, spans, line_start, line_end))
            line_start, line_end = ws, we
    lines.append(_runs(plain, spans, line_start, line_end))
    return lines


def layout():
    """-> list of pages; each page is a list of (x_inches, text)."""
    flowed = []
    for kind, text in S:
        width = WRAP[kind]
        for i, chunk in enumerate(textwrap.wrap(text, width) or [""]):
            flowed.append((kind, chunk))
        flowed.append(("blank", ""))

    pages, cur, n = [], [], 0
    for kind, text in flowed:
        if kind == "blank":
            if cur:
                cur.append(None)
                n += 1
        else:
            cur.append((X[kind], text))
            n += 1
        if n >= LINES_PER_PAGE:
            pages.append(cur)
            cur, n = [], 0
    if cur:
        pages.append(cur)
    return pages


# Styles that are DRAWN rather than selected. They never change which font a
# run uses, which mirrors how PDFs actually carry underline and is why the
# parser cannot see it from font data alone (registry 9d).
DRAWN = {"u", "k", "r", "w"}

# Block font shifts (registry 18). f picks the second FACE; t/z/g pick a
# SIZE, chosen to land one on each side of every threshold in that entry:
#   10/12 = 0.83 -> -1     15/12 = 1.25 -> +1     18/12 = 1.50 -> +2
SHIFT_SIZE = {"t": 10.0, "z": 15.0, "g": 18.0}
SHIFTS = {"f"} | set(SHIFT_SIZE)


def size_for(styles):
    for s in styles:
        if s in SHIFT_SIZE:
            return SHIFT_SIZE[s]
    return 12.0


def font_for(styles):
    """Style set -> font resource key."""
    if "f" in styles:
        return "F5"                  # a family shift, not a weight or slope
    s = set(styles) - DRAWN - SHIFTS
    if s == {"b", "i"}:
        return "F4"
    if s == {"b"}:
        return "F2"
    if s == {"i"}:
        return "F3"
    return "F1"


def styled_row_ops(x_in, y, runs):
    """-> (text operators, drawn rectangles) for one laid-out line.

    Four rule shapes, one real and three decoys. Each decoy is rejected by a
    DIFFERENT filter in collectUnderlineMarks/markUnderlinesItem, so a
    loosened threshold shows up as a stray underscore in the emitted Fountain:

      u  real underline   0.6pt tall, run-width, 2.0pt under the baseline
      k  strikethrough    same bar at baseline + 3.5 (mid x-height) -> the
                          y-window rejects anything above the baseline
      r  table border     same bar at baseline - 6.0 -> below the window, and
                          6pt ABOVE the next row's baseline, so it is out of
                          that row's window too
      w  page-wide rule   0.5in margins (540pt = 88% of the page) at the real
                          underline offset -> only the furniture-width filter
                          saves it, over real text with 100% overlap
    """
    ops, rects = [], []
    x = x_in * PT
    for run in runs:
        text, styles = run["text"], run["styles"]
        if text:
            ops += [f"/{font_for(styles)} {size_for(styles):g} Tf",
                    f"1 0 0 1 {x:.2f} {y:.2f} Tm", f"({esc(text)}) Tj"]
            w = len(text) * CHAR_W
            # A filled rectangle, not a stroked line. Real generators stroke;
            # filling here proves the detector accepts both paint ops.
            if "u" in styles:
                rects.append(f"0 g {x:.2f} {y - 2.0:.2f} {w:.2f} 0.6 re f")
            if "k" in styles:
                rects.append(f"0 g {x:.2f} {y + 3.5:.2f} {w:.2f} 0.6 re f")
            if "r" in styles:
                rects.append(f"0 g {x:.2f} {y - 6.0:.2f} {w:.2f} 0.6 re f")
            if "w" in styles:
                rects.append(f"0 g {0.5 * PT:.2f} {y - 2.0:.2f} "
                             f"{PAGE_W - 1.0 * PT:.2f} 0.6 re f")
        x += len(text) * CHAR_W
    return ops, rects


# Dual dialogue column geometry. The parser anchors a dual region on a line
# holding TWO cue-shaped clusters, then partitions body lines by start-x
# (registry 10a: the boundary starts at rightCueX - 13% and refines only
# leftward). These indents put the right cue far enough right that the
# learned boundary lands cleanly between the columns.
DUAL_X = {
    "left":  {"character": 2.2, "dialogue": 1.9, "paren": 2.4},
    "right": {"character": 5.4, "dialogue": 5.1, "paren": 5.6},
}
DUAL_WRAP = 26


def dual_rows(left, right):
    """Two (kind, text) lists -> rows where both columns share a Y.

    The cue lines of both columns MUST land on one Y, or the parser sees
    two ordinary consecutive cues rather than a dual region.
    """
    def col(items, side):
        out = []
        for kind, text in items:
            plain, spans = parse_markup(text)
            for runs in wrap_spans(plain, spans, DUAL_WRAP):
                out.append((DUAL_X[side][kind], runs))
        return out

    L, R = col(left, "left"), col(right, "right")
    rows = []
    for i in range(max(len(L), len(R))):
        pair = []
        if i < len(L):
            pair.append(L[i])
        if i < len(R):
            pair.append(R[i])
        rows.append(("multi", pair))
    rows.append(None)
    return rows, len(rows)


def flow_torture(content):
    """Lay torture content out into pages, honouring directives.

      ("pagebreak", "")   start a new page
      ("atline", n)       pad with blanks until the page is at line n
      ("dual", L, R)      two-column simultaneous dialogue
    """
    pages, cur, n = [], [], 0

    def flush():
        nonlocal cur, n
        if cur:
            pages.append(cur)
        cur, n = [], 0

    for kind, *rest in content:
        if kind == "pagebreak":
            flush()
            continue

        if kind == "atline":
            target = rest[0]
            if n > target:
                # Raising rather than overflowing is deliberate. Silently
                # sliding past the anchor would turn the (MORE) test into a
                # test of nothing the first time content above it grew by a
                # sentence, and nothing would report it.
                raise SystemExit(
                    f"atline: page {len(pages) + 1} is already at line {n}, "
                    f"cannot pad back to {target}. Content above it grew: "
                    f"shorten it, or move the anchor.")
            while n < target:
                cur.append(None)
                n += 1
            continue

        if kind == "dual":
            rows, used = dual_rows(rest[0], rest[1])
            if n + used > LINES_PER_PAGE:
                flush()
            cur.extend(rows)
            n += used
            continue

        plain, spans = parse_markup(rest[0])
        for runs in wrap_spans(plain, spans, WRAP[kind]):
            if n >= LINES_PER_PAGE:
                flush()
            cur.append((X[kind], runs))
            n += 1
        # A cue and a parenthetical sit DIRECTLY above what they introduce:
        # real scripts print no blank line there, and the geometry is the
        # whole point of this fixture. Everything else gets its blank.
        # (The inherited layout() blanks after every element; the parser
        # tolerates it, but it is not what a real page looks like.)
        if kind not in ("character", "paren") and n < LINES_PER_PAGE:
            cur.append(None)
            n += 1

    flush()
    return pages


def torture_content_stream(rows, page_no):
    """Like content_stream, but rows carry styled runs and may hold two
    columns sharing one Y."""
    text_ops, rects = ["BT", "/F1 12 Tf"], []
    if page_no:
        text_ops += [f"1 0 0 1 {X['pgnum']*PT:.2f} {PAGE_H - 0.5*PT:.2f} Tm",
                     f"({page_no}.) Tj"]
    y = TOP
    for row in rows:
        if row is not None:
            if row[0] == "multi":
                # KNOWN GAP: these two columns are emitted at correct
                # x positions on a shared Y, but the parser still joins them
                # into "BUNNY CASSIUS" rather than anchoring a dual region.
                # clusterSplit's thresholds all pass by hand-calculation, so
                # the cause is upstream of it and not yet identified.
                # tests/torture.test.ts records the current behavior.
                for x, runs in row[1]:
                    ops, rs = styled_row_ops(x, y, runs)
                    text_ops += ops
                    rects += rs
            else:
                x, runs = row
                ops, rs = styled_row_ops(x, y, runs)
                text_ops += ops
                rects += rs
        y -= LINE
    text_ops.append("ET")
    return "\n".join(rects + text_ops)


def content_stream(rows, page_no):
    out = ["BT", "/F1 12 Tf"]
    if page_no:                                   # page number, top right
        out += [f"1 0 0 1 {X['pgnum']*PT:.2f} {PAGE_H - 0.5*PT:.2f} Tm",
                f"({page_no}.) Tj"]
    y = TOP
    for row in rows:
        if row is not None:
            x, text = row
            out += [f"1 0 0 1 {x*PT:.2f} {y:.2f} Tm", f"({esc(text)}) Tj"]
        y -= LINE
    out.append("ET")
    return "\n".join(out)


def title_stream(table=None):
    out = ["BT", "/F1 12 Tf"]
    for inches_down, text in (TITLE if table is None else table):
        x = (8.5 - len(text) / 10.0) / 2.0        # 10 chars/inch, centered
        y = PAGE_H - inches_down * PT
        out += [f"1 0 0 1 {x*PT:.2f} {y:.2f} Tm", f"({esc(text)}) Tj"]
    out += [f"1 0 0 1 {1.5*PT:.2f} {1.5*PT:.2f} Tm",
            "(Placeholder Pictures) Tj",
            f"1 0 0 1 {1.5*PT:.2f} {1.5*PT - LINE:.2f} Tm",
            "(hello@example.com) Tj", "ET"]
    return "\n".join(out)


# A document that is emphatically not a screenplay: one left margin, no
# sluglines, nothing sitting in the cue/dialogue indent bands. Parses to zero
# scenes and zero dialogue, which is what NotAScreenplayError keys on. The
# ALL-CAPS headings are deliberate — at the body margin they must read as
# action, not as character cues.
PROSE = [
    "THE LAST VIDEO STORE",
    "",
    "A proposal for a documentary feature, prepared for financiers who "
    "have never rewound anything.",
    "",
    "THE OPPORTUNITY",
    "",
    "There were once nine thousand video rental stores in this country. "
    "There are now fewer than a dozen. Each one that closes takes with it "
    "a set of recommendations that existed nowhere else, held by a person "
    "who never wrote any of it down.",
    "",
    "We propose to film the last year of one of them.",
    "",
    "AUDIENCE",
    "",
    "The film is for the generation that grew up inside these rooms and "
    "for the one that has only ever been handed an algorithm. It argues, "
    "gently, that the difference between the two is a person.",
    "",
    "BUDGET",
    "",
    "A crew of four, ninety shooting days, and the patience to wait for a "
    "Tuesday when nothing happens. The full schedule follows overleaf, "
    "along with the letters of access we have already secured.",
    "",
    "This page exists to be rejected by the screenplay guard, and its "
    "prose is padded to make sure the extractor sees a healthy text "
    "layer while the parser finds nothing screenplay-shaped in it.",
]


def prose_stream():
    out = ["BT", "/F1 12 Tf"]
    y = TOP
    for para in PROSE:
        for chunk in textwrap.wrap(para, 72) or [""]:
            if chunk:
                out += [f"1 0 0 1 {1.0*PT:.2f} {y:.2f} Tm", f"({esc(chunk)}) Tj"]
            y -= LINE
    out.append("ET")
    return "\n".join(out)


def blank_stream():
    # A grey box and no text operators at all — the shape of a page scanned
    # to an image. extractDocument finds no lines, so the scanned guard fires.
    return (f"0.85 g {1.0*PT:.2f} {1.0*PT:.2f} "
            f"{PAGE_W - 2*PT:.2f} {PAGE_H - 2*PT:.2f} re f")


def build(path, streams):
    objs, n_pages = [], len(streams)
    # Objects: 1 catalog, 2 pages, then one per font, then page/content
    # pairs. Every kind carries all four fonts even when it uses one, so
    # the resource dict is identical across kinds and there is only one
    # object-numbering scheme to reason about.
    first_page_obj = 3 + len(FONTS)
    kids = " ".join(f"{first_page_obj + 2*i} 0 R" for i in range(n_pages))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>")
    for key in FONTS:
        objs.append(f"<< /Type /Font /Subtype /Type1 /BaseFont /{FONTS[key]} >>")
    res = " ".join(f"/{k} {3+i} 0 R" for i, k in enumerate(FONTS))
    for s in streams:
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.0f} "
            f"{PAGE_H:.0f}] /Resources << /Font << {res} >> >> "
            f"/Contents {len(objs)+2} 0 R >>")
        objs.append(f"<< /Length {len(s)} >>\nstream\n{s}\nendstream")

    buf, offsets = "%PDF-1.4\n", []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(buf))
        buf += f"{i} 0 obj\n{body}\nendobj\n"
    xref = len(buf)
    buf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n"
    for off in offsets:
        buf += f"{off:010d} 00000 n \n"
    buf += (f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n")
    open(path, "wb").write(buf.encode("latin-1"))
    return n_pages


KINDS = {
    "screenplay": lambda: [title_stream()] + [
        content_stream(p, i + 1 if i else None) for i, p in enumerate(layout())
    ],
    "prose": lambda: [prose_stream()],
    "blank": lambda: [blank_stream(), blank_stream()],
}


def _torture_content():
    """Load tools/torture-content.py. It is data, kept in its own file so
    the person editing 14 sheets of screenplay never has to read layout
    code. The dash in the filename means it cannot be a normal import."""
    import importlib.util
    import pathlib
    path = pathlib.Path(__file__).with_name("torture-content.py")
    spec = importlib.util.spec_from_file_location("torture_content", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def torture_streams():
    mod = _torture_content()
    pages = flow_torture(mod.CONTENT)
    return [title_stream(mod.TITLE)] + [
        torture_content_stream(p, i + 1) for i, p in enumerate(pages)
    ]


KINDS["torture"] = torture_streams


# --- layout as data, for tests -------------------------------------------
# Page PLACEMENT is the thing most likely to rot silently: a speech written
# to start at line 50 so it straddles a page break still satisfies every
# output-shaped assertion at line 48, while proving nothing. These mirror
# what the content streams draw, so an assertion about a line number is an
# assertion about the actual PDF.

def _title_rows(table):
    out = []
    for inches_down, text in table:
        x = (8.5 - len(text) / 10.0) / 2.0
        out.append({"line": int(inches_down * 6), "x": round(x, 3),
                    "runs": [{"styles": [], "text": text}], "underline": False})
    return out


def _content_rows(rows):
    out = []
    for n, row in enumerate(rows):
        if row is None:
            continue
        x, text = row
        out.append({"line": n, "x": round(x, 3),
                    "runs": [{"styles": [], "text": text}], "underline": False})
    return out


def _torture_rows(rows):
    """Styled rows, including two-column ones, as flat data. Both columns of
    a dual line report the SAME line number, which is the property that
    makes them a dual region at all."""
    out = []
    for n, row in enumerate(rows):
        if row is None:
            continue
        pairs = row[1] if row[0] == "multi" else [row]
        for x, runs in pairs:
            out.append({
                "line": n,
                "x": round(x, 3),
                "runs": [{"styles": r["styles"], "text": r["text"]} for r in runs],
                "underline": any("u" in r["styles"] for r in runs),
            })
    return out


def layout_json(kind):
    if kind == "torture":
        mod = _torture_content()
        pages = [{"page": 1, "rows": _title_rows(mod.TITLE)}]
        for i, rows in enumerate(flow_torture(mod.CONTENT)):
            pages.append({"page": i + 2, "rows": _torture_rows(rows)})
        return pages
    if kind != "screenplay":
        # prose and blank have no line-addressable structure worth emitting:
        # one is a wall of paragraphs, the other has no text operators at all.
        return []
    pages = [{"page": 1, "rows": _title_rows(TITLE)}]
    for i, rows in enumerate(layout()):
        pages.append({"page": i + 2, "rows": _content_rows(rows)})
    return pages


if __name__ == "__main__":
    import sys
    argv = sys.argv[1:]

    if argv and argv[0] == "--atline-overflow-check":
        # Proves the guard fires: asked to pad back to line 2 having already
        # emitted well past it. Exits nonzero via SystemExit's message.
        flow_torture([("action", "x " * 200), ("atline", 2)])
        sys.exit("expected atline to raise, it did not")

    if argv and argv[0] == "--wrap":
        import json
        plain, spans = parse_markup(argv[2])
        print(json.dumps(wrap_spans(plain, spans, int(argv[1]))))
        sys.exit(0)

    if argv and argv[0] == "--parse-markup":
        import json
        plain, spans = parse_markup(argv[1])
        print(json.dumps({"plain": plain, "spans": spans}))
        sys.exit(0)

    if argv and argv[0] == "--emit-layout":
        if len(argv) != 2 or argv[1] not in KINDS:
            sys.exit(f"usage: make-fixture.py --emit-layout <{'|'.join(KINDS)}>")
        import json
        print(json.dumps(layout_json(argv[1])))
        sys.exit(0)

    if len(argv) != 2 or argv[0] not in KINDS:
        sys.exit(f"usage: make-fixture.py <{'|'.join(KINDS)}> <out.pdf>")
    kind, p = argv
    print(f"{build(p, KINDS[kind]())} pages -> {p}")
