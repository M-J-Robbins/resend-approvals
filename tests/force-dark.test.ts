import { describe, expect, it } from "vitest";
import { forceDarkColor, formatColor, parseColor, type ColorRole, type Rgb } from "@/lib/client/forceDark/color";
import { isLightOnly } from "@/lib/client/forceDark/lightOnly";

// Expected values are what the reference implementation (matching Android
// WebView, and so Gmail on Android) produces for the same input.
const cases: [css: string, role: ColorRole, behind: Rgb | null, expected: string][] = [
  // Backgrounds: pure white becomes #121212; others from 206/255 brightness are inverted, capped at L 70.
  ["rgb(255, 255, 255)", "background", null, "rgb(18, 18, 18)"],
  ["rgb(250, 250, 250)", "background", null, "rgb(31, 31, 31)"],
  ["rgb(206, 206, 206)", "background", null, "rgb(64, 64, 64)"],
  ["rgb(205, 205, 205)", "background", null, "rgb(205, 205, 205)"],
  ["rgb(26, 115, 232)", "background", null, "rgb(26, 115, 232)"],
  ["rgb(255, 243, 205)", "background", null, "rgb(42, 35, 1)"],
  ["rgba(255, 255, 255, 0.4)", "background", null, "rgba(18, 18, 18, 0.4)"],
  // Text: below 150/255 brightness is inverted; hue is kept.
  ["rgb(0, 0, 0)", "foreground", null, "rgb(255, 255, 255)"],
  ["rgb(51, 51, 51)", "foreground", null, "rgb(223, 223, 223)"],
  ["rgb(136, 136, 136)", "foreground", null, "rgb(127, 127, 127)"],
  ["rgb(150, 150, 150)", "foreground", null, "rgb(150, 150, 150)"],
  ["rgb(149, 150, 150)", "foreground", null, "rgb(113, 114, 114)"],
  ["rgb(204, 0, 0)", "foreground", null, "rgb(255, 96, 53)"],
  ["rgb(255, 255, 255)", "foreground", null, "rgb(255, 255, 255)"],
  ["rgba(0, 0, 0, 0.7)", "foreground", null, "rgba(255, 255, 255, 0.7)"],
  // Borders: the text rule, then darkened while they stand out at 4.5:1 against the dark background.
  ["rgb(0, 0, 0)", "border", null, "rgb(87, 87, 87)"],
  ["rgb(229, 229, 229)", "border", [1, 1, 1], "rgb(61, 61, 61)"],
  ["rgb(34, 34, 34)", "border", [1, 1, 1], "rgb(78, 78, 78)"],
  ["rgb(7, 107, 53)", "border", [11 / 255, 128 / 255, 67 / 255], "rgb(106, 191, 130)"],
  ["rgb(221, 221, 221)", "border", null, "rgb(53, 53, 53)"],
];

describe("forced dark colours", () => {
  it.each(cases)("%s as %s", (css, role, behind, expected) => {
    const color = parseColor(css);
    expect(color).not.toBeNull();
    expect(formatColor(forceDarkColor(color!, role, behind))).toBe(expected);
  });

  it("reads computed colours the way Android does", () => {
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual([1 / 255, 2 / 255, 3 / 255, 0.5]);
    // A four-sided border-color is read as its first side.
    expect(parseColor("rgb(255, 0, 0) rgb(0, 0, 255) rgb(0, 0, 255) rgb(0, 0, 255)")).toEqual([1, 0, 0, 1]);
    expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseColor("#fff")).toEqual([1, 1, 1, 1]);
    // Colours outside rgb()/hex are left alone.
    expect(parseColor("oklch(0.5 0.15 30)")).toBeNull();
    expect(parseColor("color(display-p3 1 0 0)")).toBeNull();
  });
});

describe("Gmail's light-only opt-out", () => {
  it('is only the value "light only"', () => {
    for (const value of ["light only", "Light Only", "  light   only "]) expect(isLightOnly(value)).toBe(true);
    for (const value of ["light", "only light", "light dark", "dark", "light only dark", ""]) expect(isLightOnly(value)).toBe(false);
  });
});
