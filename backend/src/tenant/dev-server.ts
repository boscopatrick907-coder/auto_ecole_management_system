import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import app from "./worker.js";
import { developmentBindings } from "./dev-config.js";
import { closeRequestPools } from "./context.js";

let devVars: Record<string, string> = {};
try {
  const content = await fs.readFile(
    new URL("../../.dev.vars", import.meta.url),
    "utf8",
  );
  devVars = dotenv.parse(content);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error(
      "Impossible de lire backend/.dev.vars. Vérifiez les permissions du fichier.",
    );
}
// Explicit process bindings (including --env-file) override local file defaults.
// The long-running Node server reuses bounded pools; Workers stay request-local.
// SERVE_FRONTEND=1 also serves the built Angular app from this server, like the
// same-origin Cloudflare deploy (public pages, robots.txt, sitemap.xml).
const distDir = new URL(
  "../../../frontend/dist/auto-ecole-la-marseillaise-pwa/browser/",
  import.meta.url,
);
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css",
  json: "application/json", webmanifest: "application/manifest+json",
  svg: "image/svg+xml", png: "image/png", woff2: "font/woff2", txt: "text/plain",
};
async function staticFile(pathname: string): Promise<Response | null> {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  if (rel.split("/").includes("..")) return null;
  try {
    const body = await fs.readFile(new URL(rel, distDir));
    const ext = rel.split(".").pop() || "";
    return new Response(body, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
  } catch {
    return null;
  }
}
const serveFrontend = process.env.SERVE_FRONTEND === "1";
const bindings = {
  ...developmentBindings({ ...devVars, ...process.env }),
  NODE_DATABASE_POOLS: true,
  ...(serveFrontend
    ? { ASSETS: { fetch: async (req: Request) => (await staticFile(new URL(req.url).pathname)) ?? new Response("Not found", { status: 404 }) } }
    : {}),
};

const port = Number(process.env.PORT || 8788);

export const server = serve(
  {
    fetch: async (req) => {
      const started = performance.now();
      let response = await app.fetch(req, bindings);
      if (serveFrontend && response.status === 404 && req.method === "GET") {
        const file = await staticFile(new URL(req.url).pathname);
        if (file) response = file;
      }
      const elapsed = Math.round(performance.now() - started);
      response.headers.set("Server-Timing", `app;dur=${elapsed}`);
      if (elapsed >= 1000) {
        // Include no query parameters, cookies, credentials or response bodies.
        console.log(`[slow API] ${req.method} ${new URL(req.url).pathname} ${response.status} ${elapsed}ms`);
      }
      return response;
    },
    port,
  },
  (info) => {
    console.log(
      `🚗 Multi-tenant API dev server running on http://localhost:${info.port}`,
    );
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void closeRequestPools(bindings).then(() => process.exit(0));
    });
  });
}
