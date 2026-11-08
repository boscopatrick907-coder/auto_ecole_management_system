import { serve } from '@hono/node-server';
import { getLeasePublicKeyInfo } from './utils/crypto.js';
import { app } from './app.js';

if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!process.env.CORS_ORIGINS) throw new Error('CORS_ORIGINS is required.');
  if (!process.env.JWT_OFFLINE_LEASE_PRIVATE_KEY_PEM && (process.env.JWT_OFFLINE_LEASE_SECRET?.length || 0) < 32) throw new Error('A strong offline signing key is required.');
}
await getLeasePublicKeyInfo();
const port = Number(process.env.PORT || 3000);

console.log(`🚗 Auto-école La Marseillaise API démarrée sur http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
