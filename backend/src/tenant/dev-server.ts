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
const bindings = {
  ...developmentBindings({ ...devVars, ...process.env }),
  NODE_DATABASE_POOLS: true,
};

const port = Number(process.env.PORT || 8788);

export const server = serve(
  {
    fetch: async (req) => {
      const started = performance.now();
      const response = await app.fetch(req, bindings);
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
