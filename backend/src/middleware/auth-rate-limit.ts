import { normalizeCameroonPhone } from '../utils/crypto.js';
import { Context, Next } from 'hono';

/**
 * E06 — Authentication Payload Shape Validator & Rate Limiter
 *
 * Limitation note: This rate limiter stores sliding-window counters in process memory.
 * For multi-instance deployments, configure an upstream gateway rate limiter (e.g. Cloudflare
 * WAF / Redis store) in addition to this per-process defense.
 */

interface RateBucket {
  count: number;
  resetAtMs: number;
}

const ipBuckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000;
const MAX_AUTH_ATTEMPTS_PER_WINDOW = 15;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function authPayloadAndRateLimitMiddleware(c: Context, next: Next) {
  if (c.req.method === 'POST' && c.req.path !== '/api/auth/logout') {
    let rawText = '';
    try {
      rawText = await c.req.raw.clone().text();
    } catch {
      return c.json(
        { error: 'INVALID_JSON', message: 'Corps de requête illisible.' },
        400
      );
    }

    if (!rawText || rawText.trim().length === 0) {
      return c.json(
        { error: 'INVALID_PAYLOAD', message: 'Le corps JSON de la requête est requis.' },
        400
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      return c.json(
        { error: 'INVALID_JSON', message: 'Format JSON invalide.' },
        400
      );
    }

    if (!isPlainObject(parsedBody) || Object.keys(parsedBody).length === 0) {
      return c.json(
        {
          error: 'INVALID_PAYLOAD',
          message: 'Le corps de la requête doit être un objet JSON non vide.',
        },
        400
      );
    }

    // Production rate limiting (safe field access after verifying plain object shape)
    if (process.env.NODE_ENV === 'production') {
      const ip =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown-ip';

      const identifierRaw =
        typeof parsedBody.phone === 'string'
          ? parsedBody.phone.trim()
          : typeof parsedBody.identifier === 'string'
          ? parsedBody.identifier.trim()
          : 'anon';

      const normalized = identifierRaw.includes('@') ? identifierRaw.toLowerCase() : normalizeCameroonPhone(identifierRaw);
      const key = `${c.req.path}:${normalized}`; // attacker-controlled forwarding headers cannot reset an account bucket
      const now = Date.now();
      if (ipBuckets.size > 10000) { for (const [k,v] of ipBuckets) if (v.resetAtMs <= now) ipBuckets.delete(k); }
      if (ipBuckets.size > 10000) { c.header('Retry-After','600'); return c.json({error:'TOO_MANY_REQUESTS'},429); }
      const bucket = ipBuckets.get(key);

      if (!bucket || now >= bucket.resetAtMs) {
        ipBuckets.set(key, { count: 1, resetAtMs: now + WINDOW_MS });
      } else {
        bucket.count += 1;
        if (bucket.count > MAX_AUTH_ATTEMPTS_PER_WINDOW) {
          c.header('Retry-After',String(Math.ceil((bucket.resetAtMs-now)/1000)));
          return c.json(
            {
              error: 'TOO_MANY_REQUESTS',
              message: 'Trop de tentatives. Veuillez patienter une minute avant de réessayer.',
            },
            429
          );
        }
      }
    }
  }

  return next();
}
