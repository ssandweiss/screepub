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

X = {                          # inches from left edge
    "scene":  1.5, "action": 1.5, "dialogue": 2.5,
    "paren":  3.1, "character": 3.7, "trans": 1.5, "pgnum": 7.4,
}
WRAP = {"scene": 60, "action": 60, "dialogue": 35, "paren": 24,
        "trans": 60, "character": 38}   # cues never wrap in practice

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

MARKUP = re.compile(r"\{(/?)([biu])\}")


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


def title_stream():
    out = ["BT", "/F1 12 Tf"]
    for inches_down, text in TITLE:
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
    kids = " ".join(f"{4+2*i} 0 R" for i in range(n_pages))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>")
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    for s in streams:
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.0f} "
            f"{PAGE_H:.0f}] /Resources << /Font << /F1 3 0 R >> >> "
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


def layout_json(kind):
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
