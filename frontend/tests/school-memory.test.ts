import { it, expect, beforeEach } from "vitest";
import { slugify, isSlug, rememberSchool, rememberedSchool, forgetSchool } from "../src/app/core/school-memory";

// Tests run in Node: provide a minimal localStorage like the browser's.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
beforeEach(() => forgetSchool());

it("turns the school name people type into its address", () => {
  for (const typed of ["La Marseillaise", "la marseillaise", "  LA MARSEILLAISE ", "Auto-École La Marseillaise", "auto ecole la marseillaise", "la_marseillaise", "la-marseillaise"])
    expect(slugify(typed)).toBe("la-marseillaise");
  expect(slugify("École Étoile du Sud")).toBe("ecole-etoile-du-sud");
  expect(isSlug(slugify(""))).toBe(false);
});

it("remembers only valid school addresses on this device", () => {
  expect(rememberedSchool()).toBeNull();
  rememberSchool("la-marseillaise");
  expect(rememberedSchool()).toBe("la-marseillaise");
  rememberSchool("../evil");
  expect(rememberedSchool()).toBe("la-marseillaise");
  forgetSchool();
  expect(rememberedSchool()).toBeNull();
});
