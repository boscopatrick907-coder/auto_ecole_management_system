import { it, expect } from "vitest";
import { PRESETS, contrast, ensureContrast, readableOn, themeVariables, mix } from "../src/app/core/theme";

it("keeps school-colored text readable on white, whatever color is chosen", () => {
  for (const c of ["#ffff00", "#f5a623", "#7dd3fc", "#ffffff", "#2b6ca8", "#000000"]) {
    expect(contrast(ensureContrast(c, "#ffffff", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  }
  // Already-dark colors are left untouched.
  expect(ensureContrast("#1f4e8c", "#ffffff")).toBe("#1f4e8c");
});

it("chooses white or dark text on the brand color for legibility", () => {
  expect(readableOn("#1f4e8c")).toBe("#ffffff");
  expect(readableOn("#ffeb3b")).toBe("#14161a");
});

it("derives theme variables and falls back on invalid colors", () => {
  const v = themeVariables({ primary: "#2B6CA8", accent: "#d94e28" });
  expect(v["--primary"]).toBe("#2b6ca8");
  expect(v["--on-primary"]).toBe("#ffffff");
  expect(contrast(v["--primary-ink"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
  const bad = themeVariables({ primary: "red; background:url(x)", accent: "" });
  expect(bad["--primary"]).toBe("#1f4e8c");
  expect(bad["--accent"]).toBe("#f5a623");
});

it("every preset gives readable buttons and readable text", () => {
  for (const p of PRESETS) {
    const v = themeVariables(p);
    expect(contrast(v["--on-primary"], p.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v["--primary-ink"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
  }
  expect(PRESETS[0].name).toBe("Bleu Marseillaise");
  expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
});
