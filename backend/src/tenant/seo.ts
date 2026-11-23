// Server-rendered public pages for search engines and link previews.
//
// The Angular app renders in the browser, so crawlers and WhatsApp/Facebook
// previews would only ever see "Espace auto-école". For public URLs the Worker
// injects real <head> tags and readable content into index.html. Angular then
// boots and replaces the content of <app-root> as usual.

export interface PublicSchool {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  logo: string | null;
}

export interface PublicGroup {
  name: string;
  schedule_text?: string | null;
  licence_name?: string | null;
  total_fee: number | string;
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
  noindex: boolean;
  jsonLd?: unknown;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const isSlug = (v: string) => SLUG.test(v);

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON for a <script> block: "<" escaped so a value can never close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const money = (v: number | string) =>
  new Intl.NumberFormat("fr-FR").format(Number(v) || 0).replace(/ | /g, " ") + " FCFA";

/** Only https images are used for previews; anything else falls back to the default. */
export function previewImage(origin: string, logo: string | null | undefined): string {
  return logo && /^https:\/\/[^\s"<>]+$/.test(logo) ? logo : `${origin}/og-default.png`;
}

/** Path segments under /s/<slug>/ that are public entry points (login, activation...). */
const PUBLIC_ENTRY = new Set(["", "connexion", "activation", "inscription", "reinitialiser"]);

export type SchoolPathKind = "home" | "entry" | "private";
export function schoolPathKind(rest: string): SchoolPathKind {
  const first = rest.split("/").filter(Boolean)[0] ?? "";
  if (!first) return "home";
  return PUBLIC_ENTRY.has(first) ? "entry" : "private";
}

export function headTags(meta: PageMeta): string {
  const tags = [
    `<meta name="description" content="${esc(meta.description)}">`,
    `<link rel="canonical" href="${esc(meta.canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(meta.canonical)}">`,
    `<meta property="og:image" content="${esc(meta.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  if (meta.noindex) tags.push(`<meta name="robots" content="noindex">`);
  if (meta.jsonLd)
    tags.push(`<script type="application/ld+json">${scriptJson(meta.jsonLd)}</script>`);
  return tags.join("\n  ");
}

/** Puts the title, meta tags and pre-rendered body into the built index.html. */
export function injectPage(indexHtml: string, meta: PageMeta, bodyHtml: string): string {
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace("</head>", `  ${headTags(meta)}\n</head>`)
    .replace(/<app-root>\s*<\/app-root>/, `<app-root>${bodyHtml}</app-root>`);
}

export function homeMeta(origin: string): PageMeta {
  return {
    title: "Auto-écoles partenaires — cours, quiz et paiements en ligne",
    description:
      "Trouvez votre auto-école, révisez le code de la route avec des cours et quiz hors-ligne, suivez vos paiements et vos reçus.",
    canonical: `${origin}/`,
    image: `${origin}/og-default.png`,
    noindex: false,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Espace auto-école",
      url: `${origin}/`,
    },
  };
}

export function homeBody(origin: string, schools: PublicSchool[]): string {
  const items = schools
    .map(
      (s) =>
        `<li><a href="${esc(`${origin}/s/${s.slug}`)}">${esc(s.name)}</a>${
          s.address ? ` — ${esc(s.address)}` : ""
        }</li>`,
    )
    .join("");
  return `<main class="seo-prerender"><h1>Espace auto-école</h1><p>Choisissez votre auto-école pour vous inscrire, réviser le code et suivre vos paiements.</p><ul>${items}</ul></main>`;
}

export function schoolMeta(
  origin: string,
  school: PublicSchool,
  groups: PublicGroup[],
  kind: Exclude<SchoolPathKind, "private">,
  listed: boolean,
): PageMeta {
  const where = school.address ? ` à ${school.address}` : "";
  const fees = groups.map((g) => Number(g.total_fee)).filter((n) => n > 0);
  const from = fees.length ? ` Formation à partir de ${money(Math.min(...fees))}.` : "";
  const canonical = `${origin}/s/${school.slug}`;
  const titles: Record<typeof kind, string> = {
    home: `${school.name} — auto-école${where}`,
    entry: `Connexion — ${school.name}`,
  };
  return {
    title: titles[kind],
    description: `${school.name}, auto-école${where}. Inscription, cours et quiz du code de la route, paiements et reçus en ligne.${from}`,
    canonical,
    image: previewImage(origin, school.logo),
    // Only a listed school's main page is indexed; login pages never are.
    noindex: kind !== "home" || !listed,
    jsonLd:
      kind === "home"
        ? {
            "@context": "https://schema.org",
            "@type": "DrivingSchool",
            name: school.name,
            url: canonical,
            ...(school.phone ? { telephone: school.phone } : {}),
            ...(school.address ? { address: school.address } : {}),
            ...(school.logo && /^https:\/\//.test(school.logo) ? { logo: school.logo } : {}),
            ...(fees.length ? { priceRange: `${money(Math.min(...fees))} – ${money(Math.max(...fees))}` } : {}),
          }
        : undefined,
  };
}

export function schoolBody(origin: string, school: PublicSchool, groups: PublicGroup[]): string {
  const base = `${origin}/s/${school.slug}`;
  const rows = groups
    .map(
      (g) =>
        `<li>${esc(g.licence_name ? `${g.licence_name} · ` : "")}${esc(g.name)}${
          g.schedule_text ? ` (${esc(g.schedule_text)})` : ""
        } — ${esc(money(g.total_fee))}</li>`,
    )
    .join("");
  const contact = [
    school.address ? `<p>Adresse : ${esc(school.address)}</p>` : "",
    school.phone ? `<p>Téléphone : ${esc(school.phone)}</p>` : "",
  ].join("");
  return `<main class="seo-prerender"><h1>${esc(school.name)}</h1>${contact}${
    rows ? `<h2>Formations</h2><ul>${rows}</ul>` : ""
  }<p><a href="${esc(base)}/inscription">S’inscrire</a> · <a href="${esc(base)}/connexion">Se connecter</a> · <a href="${esc(base)}/activation">J’ai un code</a></p></main>`;
}

/** Staging and development must never be indexed (test data, duplicate content). */
export function robotsTxt(origin: string, indexable = true): string {
  if (!indexable) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nDisallow: /api/\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin: string, schools: Pick<PublicSchool, "slug">[]): string {
  const urls = [`${origin}/`, ...schools.map((s) => `${origin}/s/${s.slug}`)]
    .map((u) => `  <url><loc>${esc(u)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
