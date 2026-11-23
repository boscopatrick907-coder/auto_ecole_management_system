const KEY = "aem:last-school";
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Turns what people type into a school address: "La Marseillaise",
 * "Auto-École La Marseillaise", "la_marseillaise" -> "la-marseillaise".
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\s*auto[\s-]*ecole\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function isSlug(value: string | null | undefined): value is string {
  return !!value && SLUG.test(value);
}

/** Last school opened on this device, so the home page can reopen it. */
export function rememberSchool(slug: string) {
  try {
    if (isSlug(slug)) localStorage.setItem(KEY, slug);
  } catch {
    /* private mode or storage disabled: nothing to remember */
  }
}

export function rememberedSchool(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return isSlug(v) ? v : null;
  } catch {
    return null;
  }
}

export function forgetSchool() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
