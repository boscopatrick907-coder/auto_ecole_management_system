import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import app from "./worker.js";
import { developmentBindings } from "./dev-config.js";

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
const bindings = developmentBindings({ ...devVars, ...process.env });

const port = Number(process.env.PORT || 8788);

export const server = serve(
  {
    fetch: (req) => app.fetch(req, bindings),
    port,
  },
  (info) => {
    console.log(
      `🚗 Multi-tenant API dev server running on http://localhost:${info.port}`,
    );
  },
);
