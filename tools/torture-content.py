"""Content for the torture fixture. Data only, no layout logic.

This is the file a human edits, so it deliberately carries no geometry:
tools/make-fixture.py owns wrapping, pagination and PDF emission.

Every registry behavior this exercises has a row in
tools/torture-manifest.json. Edit the two together, or
tests/torture-coverage.test.ts will say so.

CONFIDENTIALITY: every title, author, character and location here is
invented. Nothing from the gitignored root /fixtures/ may ever appear in
this file. It is committed, public, and shows up in screenshots.
"""

TITLE = [
    (4.0, "THE PROOF SHEET"),
    (4.5, "Written by"),
    (5.0, "A. N. Placeholder"),
]

# Saturation cast, deliberately small so the roster stays realistic. Forty
# one-off names would stress cue detection but produce a roster no real
# script has, which would confuse what the saturation pages measure.
CAST = ["BUNNY", "CASSIUS", "ODILE", "WREN"]

NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight",
           "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
           "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
           "twenty", "twenty-one", "twenty-two", "twenty-three",
           "twenty-four", "twenty-five", "twenty-six", "twenty-seven",
           "twenty-eight", "twenty-nine", "thirty", "thirty-one",
           "thirty-two", "thirty-three", "thirty-four", "thirty-five",
           "thirty-six", "thirty-seven", "thirty-eight", "thirty-nine",
           "forty"]

_KEEP = ("If this line sits alone at the top or the bottom of a page, the "
         "keep failed. ")


def saturation():
    """Numbered speeches for the saturation pages.

    Lengths cycle 1/2/4/3 rather than repeating one shape. A uniform period
    could align with the device's page height and put every break in the
    same relative position, saturating nothing. Speeches name their own
    number so a device defect is reportable as "speech twenty-seven" rather
    than "somewhere in the back half".
    """
    out = []
    shapes = [1, 2, 4, 3]
    for i, n in enumerate(NUMBERS):
        who = CAST[i % len(CAST)]
        lines = shapes[i % len(shapes)]
        body = f"Speech {n}. "
        body += "Short." if lines == 1 else (_KEEP * (lines - 1))
        out.append(("character", who))
        out.append(("dialogue", body.strip()))
    return out


CONTENT = [
    # ---- page 1: sluglines of every shape -------------------------------
    ("scene", "INT. ARCHIVE BASEMENT - NIGHT"),
    ("action", "Steel shelving to the ceiling. A single bulb, swinging."),
    ("scene", "EXT. LOADING DOCK - CONTINUOUS"),
    ("action", "Rain on corrugated tin, loud enough to argue over."),
    ("scene", "INT./EXT. DELIVERY VAN - MOVING - LATER"),
    ("action", "The wipers lose."),
    ("scene", "42 INT. ARCHIVE BASEMENT - RESHELVING - DAY 42"),
    ("action", "A dual-margin scene number, the shooting-script shape: the "
               "same number printed at both margins."),
    ("pagebreak", ""),

    # ---- page 2: transitions, mini-slugs, furniture ----------------------
    ("scene", "INT. READING ROOM - DAY"),
    ("action", "ODILE sets down a box that is heavier than it looks."),
    ("mini", "THE INDEX CARDS"),
    ("action", "Handwriting from four decades, none of it consistent."),
    ("mini", "THE LEDGER"),
    ("action", "One column, ruled in pencil, never once balanced."),
    ("trans", "CUT TO:"),
    ("scene", "INT. STAIRWELL - CONTINUOUS"),
    ("action", "Footsteps going down two at a time."),
    ("trans", "DISSOLVE TO:"),
    ("scene", "EXT. ARCHIVE - NIGHT"),
    ("action", "The building keeps its lights on for nobody."),
    ("trans", "SMASH CUT TO:"),
    ("pagebreak", ""),

    # ---- page 3: cue extensions and hybrids ------------------------------
    ("scene", "INT. ARCHIVE BASEMENT - NIGHT"),
    ("action", "Nobody is where their voice says they are."),
    ("character", "BUNNY"),
    ("paren", "(O.S.)"),
    ("dialogue", "The period-full spelling, the one the manuals print."),
    ("character", "CASSIUS"),
    ("paren", "(V.O)"),
    ("dialogue", "And the one writers actually type, missing its period."),
    ("character", "ODILE"),
    ("paren", "(O.C)"),
    ("dialogue", "Off camera, also missing its period."),
    ("character", "WREN (CONT'D)"),
    ("dialogue", "A continued cue, carrying its extension."),
    ("character", "DR. E. T. MARCHETTI"),
    ("dialogue", "Dotted abbreviations sitting inside a character name."),
    ("character", "BUNNY (V.O.)"),
    ("dialogue", "A hybrid: name and extension on one cue line."),
    ("pagebreak", ""),

    # ---- page 4: parentheticals and roster rescue ------------------------
    ("scene", "INT. READING ROOM - DAY"),
    ("action", "The box is open now. It was not worth the trip."),
    ("character", "BUNNY"),
    ("paren", "(quietly)"),
    ("dialogue", "A leading parenthetical, before a word is spoken."),
    ("character", "CASSIUS"),
    ("dialogue", "A line, and then a beat in the middle of it."),
    ("paren", "(reconsidering)"),
    ("dialogue", "And then the rest of it, after the beat."),
    ("character", "ODILE"),
    ("paren", "(standing)"),
    ("paren", "(then, to WREN)"),
    ("dialogue", "Two stacked parentheticals before any dialogue at all."),
    ("character", "WREN"),
    ("dialogue", "Short."),
    ("pagebreak", ""),

    # ---- page 5: dialogue extremes, and the (MORE) anchor ----------------
    ("scene", "INT. ARCHIVE BASEMENT - NIGHT"),
    ("action", "They have been at this for six hours."),
    ("character", "WREN"),
    ("dialogue", "No."),
    ("character", "BUNNY"),
    ("dialogue", "Yes."),
    ("character", "WREN"),
    ("dialogue", "No."),
    # Anchored so the speech below straddles the page break and the parser
    # has to rejoin it across the (MORE) and (CONT'D) furniture a real
    # script prints there. Doubles as the long-dialogue case.
    ("atline", 44),
    ("character", "ODILE"),
    ("dialogue",
     "MORE-ANCHOR. This speech begins near the foot of the page on purpose, "
     "so that it runs over the break and has to be put back together on the "
     "other side. It keeps going well past the boundary so the rejoin has "
     "something substantial to work with, and so that the same speech "
     "doubles as the long-dialogue case the coverage table asks for, rather "
     "than spending two constructions on what is really one shape."),
    ("pagebreak", ""),

    # ---- page 6: rich formatting -----------------------------------------
    ("scene", "INT. CONSERVATION BENCH - DAY"),
    ("action", "The label reads {b}DO NOT LAMINATE{/b}, twice."),
    ("action", "She says it {i}again{/i}, and this time somebody writes it down."),
    ("action", "The stamp is {b}{i}both bold and italic{/i}{/b} at once."),
    ("action", "A styled run that {b}crosses the wrap boundary because it "
               "keeps going for long enough to need a second line{/b}, and "
               "then stops."),
    ("action", "Punctuation only{b},{/b} styled by itself."),
    ("action", "This word is {u}underlined{/u} with drawn vector art."),
    ("character", "CASSIUS"),
    ("dialogue", "Dialogue can be {b}bold{/b} too."),
    ("character", "ODILE"),
    ("dialogue", "And {i}italic{/i}, which is the common one."),
    ("pagebreak", ""),

    # ---- page 7: dual dialogue, short then tall --------------------------
    ("scene", "INT. READING ROOM - DAY"),
    ("action", "They speak over each other."),
    ("dual",
     [("character", "BUNNY"), ("dialogue", "LEFTMARK. Short, on the left.")],
     [("character", "CASSIUS"), ("dialogue", "RIGHTMARK. Short, on the right.")]),
    ("action", "And again, at length."),
    ("dual",
     [("character", "ODILE"),
      ("dialogue", "This column runs long enough that the taller of the two "
                   "passes twelve estimated rendered lines, which is the "
                   "threshold where the side-by-side table gives up and both "
                   "speeches become ordinary sequential dialogue instead.")],
     [("character", "WREN"),
      ("dialogue", "And this one answers at similar length so neither column "
                   "is trivially short, because the fallback measures the "
                   "taller of the pair and a stub would never reach it.")]),
    ("pagebreak", ""),
] + saturation()
