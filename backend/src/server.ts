import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT || 8788);

console.log(`🚗 Auto-école La Marseillaise API démarrée sur http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
