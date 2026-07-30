import { test, expect, describe } from "bun:test";
import { isBoilerplateLine, suppressBoilerplate } from "../src/parser/boilerplate";
import type { ScreenplayElement } from "../src/parser/types";

function el(over: Partial<ScreenplayElement> & { id: string; text: string; pageNum: number }): ScreenplayElement {
  return { type: "action", isTitlePage: false, isReadable: true, ...over };
}

describe("isBoilerplateLine — revision slugs", () => {
  test("Ama's literal doubled slug with page mark", () => {
    expect(isBoilerplateLine("Blue Rev. (mm/dd/yy)Blue Rev. (mm/dd/yy) 15.15")).toBe(true);
  });
  test("single slug variants", () => {
    expect(isBoilerplateLine("Blue Rev. (6/12/26)")).toBe(true);
    expect(isBoilerplateLine("Pink Revision 06/12/2026")).toBe(true);
    expect(isBoilerplateLine("2nd Blue Rev. (6/12/26) 22.")).toBe(true);
    expect(isBoilerplateLine("Goldenrod Rev.")).toBe(true);
  });
  test("draft stamps and header dates", () => {
    expect(isBoilerplateLine("FIRST DRAFT")).toBe(true);
    expect(isBoilerplateLine("SHOOTING SCRIPT 3/4/26")).toBe(true);
    expect(isBoilerplateLine("PRODUCTION DRAFT — 03/04/2026")).toBe(true);
    expect(isBoilerplateLine("6/12/26")).toBe(true);
  });
  test("trailing page marks alone", () => {
    expect(isBoilerplateLine("15.15")).toBe(true);
    expect(isBoilerplateLine("A15.")).toBe(true);
  });
  test("near-misses must NOT match", () => {
    expect(isBoilerplateLine("Blue reveals the knife slowly.")).toBe(false);
    expect(isBoilerplateLine("The first draft of her letter sat unread.")).toBe(false);
    expect(isBoilerplateLine("It happened on 6/12/26, the day everything changed.")).toBe(false);
    expect(isBoilerplateLine("He counted: 15.15 seconds exactly, then jumped.")).toBe(false);
  });
  test("bare color words must NOT match (color-named character cues)", () => {
    expect(isBoilerplateLine("CHERRY")).toBe(false);
    expect(isBoilerplateLine("BLUE")).toBe(false);
    expect(isBoilerplateLine("Blue Rev.")).toBe(true);
  });
});

describe("suppressBoilerplate — recurrence", () => {
  const PAGES = 97;
  function watermarked(onPages: number[]): ScreenplayElement[] {
    const els: ScreenplayElement[] = [];
    let i = 0;
    for (let p = 1; p <= PAGES; p++) {
      if (onPages.includes(p)) els.push(el({ id: `w${i++}`, text: "Property of Placeholder Pictures — A. N. Placeholder", pageNum: p }));
      els.push(el({ id: `a${i++}`, text: `Something happens on page ${p}.`, pageNum: p }));
    }
    return els;
  }
  test("watermark on 40 of 97 pages is suppressed", () => {
    const pages = Array.from({ length: 40 }, (_, k) => k + 1);
    const out = suppressBoilerplate(watermarked(pages), PAGES);
    expect(out.filter((e) => e.text.startsWith("Property of")).every((e) => e.type === "page-number")).toBe(true);
    expect(out.filter((e) => e.text.startsWith("Something")).every((e) => e.type === "action")).toBe(true);
  });
  test("2-page recurrence is kept", () => {
    const out = suppressBoilerplate(watermarked([1, 2]), PAGES);
    expect(out.filter((e) => e.text.startsWith("Property of")).every((e) => e.type === "action")).toBe(true);
  });
  test("repeated DIALOGUE is never suppressed", () => {
    const els = Array.from({ length: 50 }, (_, p) =>
      el({ id: `d${p}`, text: "REDRUM", pageNum: p + 1, type: "dialogue", character: "DANNY" }),
    );
    const out = suppressBoilerplate(els, PAGES);
    expect(out.every((e) => e.type === "dialogue")).toBe(true);
  });
  test("long repeated action lines are kept (length cap)", () => {
    const long = "The same long ritual description repeats in this script for deliberate effect, well over the cap.";
    const els = Array.from({ length: 50 }, (_, p) => el({ id: `l${p}`, text: long, pageNum: p + 1 }));
    expect(suppressBoilerplate(els, PAGES).every((e) => e.type === "action")).toBe(true);
  });
  test("pattern-layer slugs with per-page-varying page marks are suppressed without recurrence", () => {
    // Ama's literal: the embedded page mark changes every page, so each
    // page's text is unique and the recurrence layer alone never fires.
    const els = Array.from({ length: PAGES }, (_, k) =>
      el({ id: `s${k}`, text: `Blue Rev. (6/12/26) ${k + 1}.${k + 1}`, pageNum: k + 1 }),
    );
    const out = suppressBoilerplate(els, PAGES);
    expect(out.every((e) => e.type === "page-number")).toBe(true);
  });
  test("a recurring mini-slug is suppressed exactly like action", () => {
    // Classification runs first, so a left-flush all-caps watermark can reach
    // here already typed as a mini-slug. One rule for both types: a document
    // gets ONE verdict per watermark, and a mark that types action on some
    // pages and mini-slug on others cannot come out half hidden. #5b.
    const els = Array.from({ length: 50 }, (_, p) =>
      el({ id: `w${p}`, text: "CONFIDENTIAL", pageNum: p + 1, type: "mini-slug" }),
    );
    expect(suppressBoilerplate(els, PAGES).every((e) => e.type === "page-number")).toBe(true);
  });
  test("a mini-slug under the threshold keeps its heading", () => {
    const els = Array.from({ length: 3 }, (_, p) =>
      el({ id: `s${p}`, text: "LATER", pageNum: p + 1, type: "mini-slug" }),
    );
    expect(suppressBoilerplate(els, PAGES).every((e) => e.type === "mini-slug")).toBe(true);
  });
  test("a mixed-type watermark gets one verdict, not two", () => {
    // The pool must see what it saw before classify.ts learned to mint
    // mini-slugs, or the same watermark typed action on one page and
    // mini-slug on the next stops reaching the threshold — and both halves
    // must land on the same type, or the same mark reads hidden on 39 pages
    // and visible on the 40th.
    const els = [
      ...Array.from({ length: 39 }, (_, p) =>
        el({ id: `m${p}`, text: "PROPERTY OF THE STUDIO", pageNum: p + 1, type: "mini-slug" as const }),
      ),
      el({ id: "a1", text: "PROPERTY OF THE STUDIO", pageNum: 40 }),
    ];
    expect(suppressBoilerplate(els, PAGES).every((e) => e.type === "page-number")).toBe(true);
  });

  test("idempotent for mini-slugs too", () => {
    const els = Array.from({ length: 50 }, (_, p) =>
      el({ id: `w${p}`, text: "CONFIDENTIAL", pageNum: p + 1, type: "mini-slug" as const }),
    );
    const once = suppressBoilerplate(els, PAGES);
    expect(suppressBoilerplate(once, PAGES)).toEqual(once);
  });
  test("idempotent and index-preserving", () => {
    const pages = Array.from({ length: 40 }, (_, k) => k + 1);
    const once = suppressBoilerplate(watermarked(pages), PAGES);
    const twice = suppressBoilerplate(once, PAGES);
    expect(twice).toEqual(once);
    expect(twice.map((e) => e.id)).toEqual(watermarked(pages).map((e) => e.id));
  });
});
