/**
 * School theme engine. Each school only chooses two colors (primary and
 * secondary/accent) in Paramètres; everything else — readable text colors,
 * tints, gradients and shadows — is derived here and in styles.css, so any
 * pair of colors gives a coherent, legible app.
 */

export interface ThemeColors {
  primary: string;
  accent: string;
}

/** Ready-made palettes offered in Paramètres. The first one is La Marseillaise's. */
export const PRESETS: ReadonlyArray<{ id: string; name: string } & ThemeColors> = [
  { id: "marseillaise", name: "Bleu & orange", primary: "#1f5fae", accent: "#f7931e" },
  { id: "ocean", name: "Océan", primary: "#0f5e9c", accent: "#14b8a6" },
  { id: "foret", name: "Forêt", primary: "#166534", accent: "#eab308" },
  { id: "savane", name: "Savane", primary: "#9a3412", accent: "#f59e0b" },
  { id: "royal", name: "Royal", primary: "#4338ca", accent: "#ec4899" },
  { id: "nuit", name: "Nuit", primary: "#1e293b", accent: "#38bdf8" },
  { id: "cerise", name: "Cerise", primary: "#9f1239", accent: "#fb7185" },
];

export const DEFAULT_THEME: ThemeColors = { primary: "#1f5fae", accent: "#f7931e" };

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `hex` toward `target` by `amount` (0–1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = rgb(hex),
    b = rgb(target);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as [number, number, number]);
}

/** Darken (or lighten) until the color reaches `ratio` contrast against `background`. */
export function ensureContrast(hex: string, background: string, ratio = 4.5): string {
  const target = luminance(background) > 0.5 ? "#000000" : "#ffffff";
  let c = hex;
  for (let step = 0; step < 20 && contrast(c, background) < ratio; step++) c = mix(c, target, 0.08);
  return c;
}

/** White or near-black text, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  return contrast("#ffffff", hex) >= contrast("#14161a", hex) ? "#ffffff" : "#14161a";
}

/** CSS custom properties for a school; invalid colors fall back to the default theme. */
export function themeVariables(colors: Partial<ThemeColors> | null | undefined): Record<string, string> {
  const primary = isHex(colors?.primary) ? colors!.primary.toLowerCase() : DEFAULT_THEME.primary;
  const accent = isHex(colors?.accent) ? colors!.accent.toLowerCase() : DEFAULT_THEME.accent;
  return {
    "--primary": primary,
    "--accent": accent,
    // Text/links in the school color, always readable on white and light tints.
    "--primary-ink": ensureContrast(primary, "#ffffff", 4.8),
    "--accent-ink": ensureContrast(accent, "#ffffff", 4.5),
    // Text on top of the brand color / gradient.
    "--on-primary": readableOn(primary),
    "--on-accent": readableOn(accent),
  };
}

/** Applies a school's theme to the document. */
export function applyTheme(colors: Partial<ThemeColors> | null | undefined, root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(themeVariables(colors))) root.style.setProperty(k, v);
}
