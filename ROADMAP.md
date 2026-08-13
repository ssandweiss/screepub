# Roadmap

Screepub is early. It converts screenplay PDFs into e-books that hold their
shape on an e-reader, it works offline, and it's been proven on a Kindle.
Everything below is what comes next, roughly in order.

This is a small project maintained by one person, so treat dates as absent
rather than optimistic. Things move up the list when people ask for them —
see [Influencing this list](#influencing-this-list).

## Now

- **Images in the script, carried into the e-book.** Filmmakers put pictures
  in scripts: storyboard panels, a reference photo, a lookbook page, a
  designed title card. Screepub reads the text around them and drops every
  one. The work comes in three parts, and each is useful on its own:
  recognising that a page holds an image and where it sits, passing it
  through into the e-book at a sensible size, and promoting a full-page
  image at the front into the book's actual cover, so a script with a
  designed title page shows up as artwork in your library instead of a row
  of identical grey rectangles. Two honest limits: most e-ink screens are
  greyscale, so a colour image will read as black and white on a Kindle
  whatever we do, and a script padded with full-page photographs makes a
  file too large to email to a `@kindle.com` address.
- **Windows and Linux builds of the command-line converter.** The engine is
  already portable; only the release workflow is Mac-only. This is the
  single biggest increase in who can use Screepub.
- **A way to report problems without a GitHub account.** Today every
  feedback path assumes one, which excludes most of the people Screepub is
  built for.
- **Housekeeping.** Keeping `pdfjs-dist` current — it's the component that
  parses untrusted PDFs, so it's the one that matters — plus a Homebrew tap
  that updates itself on release, and a fix for an inflated "speaking
  characters" count when a title page line sits at the same indent as a
  character cue.

## Next

Deliberately unwritten. Screepub is in beta with a handful of real readers,
and what they trip over decides this section. If you're using it, what
annoys you is more useful than anything on this page.

## Later

**Sides — reading one character's script.** Extract only the scenes a given
character appears in, or emphasise their lines throughout. Screepub already
identifies every scene and every character cue while converting; this puts
that to work. Actors, directors and anyone running a table read do this by
hand today. This is the feature most likely to be built next.

**Comparing drafts.** Show what actually changed between two revisions of a
script, scene by scene, instead of a page-by-page PDF diff that reflows into
noise. Screepub already recognises revision marks and scene boundaries.

**A conversion report.** Page count, scene count, and how many lines each
character speaks — all of it is already computed during conversion and then
thrown away. Useful if you read scripts in volume.

**A running header that says which scene you're in.** On paper you keep your
place with your thumb and the shape of the page. Reflowed onto a screen both
of those go away, and it's easy to lose track of where a scene started once
the slugline has scrolled off. Screepub already identifies every scene
boundary while converting, so carrying the current slugline in a page header
is mostly a formatting question. Two honest limits: sideloaded Kindles ignore
most header styling, and a header costs a line of screen on a six-inch
device, so it would ship as a toggle rather than always-on.

**The screenplay typeface, everywhere.** Screepub asks each device for
Courier Prime, the typeface of a printed script, but most devices don't
carry it and quietly substitute their own typewriter font. Bundling the
font inside the e-book (its open license allows exactly this) would make
scripts look the same nearly everywhere: every USB route Screepub ships
(Kindle, Kobo, tolino) honors embedded fonts, and Apple Books does too
with a one-line fix Screepub can make. It would ship as a toggle rather
than always-on: the four font styles add roughly half a megabyte,
Amazon's Send-to-Kindle service strips embedded fonts no matter what,
and reMarkable hasn't been tested with them.

**Converting several scripts at once** in the app. The command-line tool can
already be looped; the app can't.

**Right-click a PDF in Finder** and send it to your e-reader, without
opening Screepub at all.

**A graphical Screepub off the Mac.** The app is macOS-only and a second
native app isn't realistic for one maintainer. The likely answer is a local
web interface — served from your own machine, nothing uploaded — giving
Windows and Linux a real window instead of a terminal. This is waiting on
demand rather than on effort: **if you want it, say so in an issue.** That's
the signal that moves it.

## Influencing this list

The two most useful things you can send:

**A device report.** Kobo, tolino and reMarkable support is written but has
never run on real hardware — nobody has plugged one in. Five minutes with
one of those, either outcome, is worth more than any feature request.

**What broke.** A script that converted badly tells us more than a script
that converted well. Please don't attach confidential material — a
description of where the text sat on the page is almost always enough, and
`tools/make-fixture.py` shows how to build a small invented script that
reproduces a given shape.

[Open an issue.](https://github.com/ssandweiss/screepub/issues/new/choose)
