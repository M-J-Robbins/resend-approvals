/**
 * Colour maths for simulating Android's forced dark mode: how Chromium's
 * "Auto Dark Mode for Web Contents" (used by Android WebView, and so by Gmail
 * on Android) rewrites the colours of a page that has no dark mode of its own.
 *
 * Channels are 0–1 throughout. The steps, per colour:
 *  - Decide its role: text (foreground), background, or border.
 *  - Measure perceived brightness (BT.601). Text darker than 150/255 and
 *    backgrounds at least 206/255 are inverted; anything else is kept.
 *  - Invert in CIE Lab: lightness L becomes min(110 − L, ceiling), where the
 *    ceiling is 70 for backgrounds and 100 for text. Pure white backgrounds
 *    become #121212 instead (Material's dark surface).
 *  - Borders use the text rule, then are darkened in steps while they still
 *    stand out at 4.5:1 or more against their (darkened) background.
 *
 * The output must match what Android shows, so the constants, rounding and
 * clamping follow Chromium's source exactly, quirks included:
 *  - dark_mode_lab_color_space.h, whose Bradford matrix has +0.0685 where the
 *    published one has −0.0685. Its sRGB↔XYZ(D50) matrices are used as is.
 *  - dark_mode_color_classifier.cc and dark_mode_color_filter.cc (thresholds
 *    and roles), and color.cc (Color::Dark(), used for borders).
 */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type ColorRole = "foreground" | "background" | "border";

const TEXT_THRESHOLD = 150 / 255;
const BACKGROUND_THRESHOLD = 206 / 255;
const BACKGROUND_LIGHTNESS_CEILING = 70;
const TEXT_LIGHTNESS_CEILING = 100;
/** #121212: what a pure white background becomes, and the assumed page background. */
export const DARK_SURFACE = 18 / 255;
const READABLE_CONTRAST = 4.5;
/** Color::Dark() in color.cc subtracts this from the brightest channel. */
const DARKEN_STEP = 0.33;
const MAX_DARKEN_STEPS = 10;

/** Perceived brightness, ITU-R BT.601 weights. */
export function brightness([r, g, b]: Rgb): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** WCAG 2 contrast ratio. WCAG's 0.03928 cut-off, not sRGB's 0.04045, as in Chromium. */
export function contrastRatio(x: Rgb, y: Rgb): number {
  const a = luminance(x);
  const b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/* ---------- sRGB ↔ CIE Lab (D50), as Chromium computes it ---------- */

const D50_WHITE: Rgb = [0.964212, 1.0, 0.825188];

// Chromium's Bradford-adapted matrices (see the note at the top), row-major.
const LINEAR_SRGB_TO_XYZ = [
  [0.4348794143, 0.3820188842, 0.147313616],
  [0.2221231146, 0.7159544776, 0.0619223917],
  [0.0070117025, 0.0783932823, 0.7397832234],
] as const;
const XYZ_TO_LINEAR_SRGB = [
  [3.134231134, -1.618861499, -0.4886176578],
  [-0.9787888975, 1.915210658, 0.03459730693],
  [0.07401381424, -0.1876072208, 1.352712272],
] as const;

const transform = (m: readonly (readonly number[])[], [x, y, z]: Rgb): Rgb => [
  m[0][0] * x + m[0][1] * y + m[0][2] * z,
  m[1][0] * x + m[1][1] * y + m[1][2] * z,
  m[2][0] * x + m[2][1] * y + m[2][2] * z,
];

const decodeSrgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encodeSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const DELTA = 6 / 29;

function toLab(rgb: Rgb): Rgb {
  const [x, y, z] = transform(LINEAR_SRGB_TO_XYZ, [decodeSrgb(rgb[0]), decodeSrgb(rgb[1]), decodeSrgb(rgb[2])]);
  const f = (t: number) => (t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29);
  const fx = f(x / D50_WHITE[0]);
  const fy = f(y / D50_WHITE[1]);
  const fz = f(z / D50_WHITE[2]);
  return [clamp(116 * fy - 16, 0, 100), clamp(500 * (fx - fy), -128, 128), clamp(200 * (fy - fz), -128, 128)];
}

function fromLab([l, a, b]: Rgb): Rgb {
  const fInverse = (t: number) => (t > DELTA ? t * t * t : 3 * DELTA ** 2 * (t - 4 / 29));
  const fy = (l + 16) / 116;
  const xyz: Rgb = [
    D50_WHITE[0] * fInverse(fy + a * 0.002),
    D50_WHITE[1] * fInverse(fy),
    D50_WHITE[2] * fInverse(fy - b * 0.005),
  ];
  const linear = transform(XYZ_TO_LINEAR_SRGB, xyz);
  return [clamp(encodeSrgb(linear[0]), 0, 1), clamp(encodeSrgb(linear[1]), 0, 1), clamp(encodeSrgb(linear[2]), 0, 1)];
}

/** Flips Lab lightness around 55 (L → 110 − L), capped at `ceiling`; hue and chroma are kept. */
export function invertLightness(rgb: Rgb, ceiling: number): Rgb {
  const [l, a, b] = toLab(rgb);
  return fromLab([Math.min(110 - l, ceiling), a, b]);
}

/* ---------- Borders ---------- */

/** Color::Dark(): scales every channel so the brightest drops by 0.33, rounded to whole 8-bit steps. */
function darken([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  if (max === 0) return [0, 0, 0];
  const scale = Math.max(0, (max - DARKEN_STEP) / max);
  return [Math.round(r * scale * 255) / 255, Math.round(g * scale * 255) / 255, Math.round(b * scale * 255) / 255];
}

/** Darkens a border, a step at a time, until it no longer stands out at 4.5:1 against `background`. */
function softenBorder(border: Rgb, background: Rgb): Rgb {
  let current = border;
  for (let step = 0; step < MAX_DARKEN_STEPS; step++) {
    if (contrastRatio(current, background) < READABLE_CONTRAST) return current;
    current = darken(current);
  }
  return current;
}

/* ---------- Per-role transform ---------- */

/**
 * The colour Android shows for `color` in the given role. `behind` is the
 * nearest opaque background (before dark mode), used only for borders.
 */
export function forceDarkColor(color: Rgba, role: ColorRole, behind: Rgb | null): Rgba {
  const rgb: Rgb = [color[0], color[1], color[2]];
  const alpha = color[3];
  const light = brightness(rgb);

  if (role === "border") {
    let border = light < TEXT_THRESHOLD ? invertLightness(rgb, TEXT_LIGHTNESS_CEILING) : rgb;
    const darkBehind: Rgb = behind
      ? sliceRgb(forceDarkColor([...behind, 1], "background", null))
      : [DARK_SURFACE, DARK_SURFACE, DARK_SURFACE];
    if (contrastRatio(border, darkBehind) >= READABLE_CONTRAST) border = softenBorder(border, darkBehind);
    return [...border, alpha];
  }

  const invert = role === "foreground" ? light < TEXT_THRESHOLD : light >= BACKGROUND_THRESHOLD;
  if (!invert) return color;
  if (role === "background" && rgb[0] >= 1 && rgb[1] >= 1 && rgb[2] >= 1) {
    return [DARK_SURFACE, DARK_SURFACE, DARK_SURFACE, alpha];
  }
  return [...invertLightness(rgb, role === "background" ? BACKGROUND_LIGHTNESS_CEILING : TEXT_LIGHTNESS_CEILING), alpha];
}

const sliceRgb = (c: Rgba): Rgb => [c[0], c[1], c[2]];

/* ---------- CSS colour strings ---------- */

const RGB_FUNCTION = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/;
const HEX = /^#([0-9a-fA-F]{3,8})$/;

/**
 * Reads a computed colour. Only rgb()/rgba() (the first one in the string, so
 * a four-sided border-color reads as its first side), hex and "transparent";
 * anything else, such as oklch(), is left alone, as on Android.
 */
export function parseColor(css: string): Rgba | null {
  const fn = RGB_FUNCTION.exec(css);
  if (fn) {
    return [Number.parseInt(fn[1], 10) / 255, Number.parseInt(fn[2], 10) / 255, Number.parseInt(fn[3], 10) / 255, fn[4] ? Number.parseFloat(fn[4]) : 1];
  }
  const hex = HEX.exec(css)?.[1];
  if (hex) {
    const byte = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    if (hex.length === 3) {
      const nibble = (i: number) => Number.parseInt(hex[i] + hex[i], 16) / 255;
      return [nibble(0), nibble(1), nibble(2), 1];
    }
    // Other lengths are read the same way; missing digits give NaN. Computed styles never return hex.
    return [byte(0), byte(2), byte(4), hex.length === 6 ? 1 : byte(6)];
  }
  if (css === "transparent") return [0, 0, 0, 0];
  return null;
}

/** "rgb(r, g, b)", or "rgba(r, g, b, a)" when not opaque. */
export function formatColor([r, g, b, a]: Rgba): string {
  const channels = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;
  return a < 1 ? `rgba(${channels}, ${a})` : `rgb(${channels})`;
}
