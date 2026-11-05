import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getPool } from '../db.js';
import { sha256Hex } from '../utils/crypto.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'student';
  sessionId: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser | null;
  }
}

export function extractToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieToken = getCookie(c, 'lm_session');
  if (cookieToken) {
    return cookieToken;
  }
  return null;
}

export async function authMiddleware(c: Context, next: Next) {
  const rawToken = extractToken(c);
  if (!rawToken) {
    c.set('user', null);
    return next();
  }

  const tokenHash = sha256Hex(rawToken);
  const pool = getPool();
  const res = await pool.query(
    `SELECT s.id AS session_id,
            u.id AS user_id,
            u.name,
            u.email,
            u.phone,
            COALESCE(p.role, 'student') AS role
     FROM public.sessions s
     JOIN public.users u ON u.id = s.user_id
     LEFT JOIN public.profiles p ON p.id = u.id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [tokenHash]
  );

  if (res.rowCount === 0) {
    c.set('user', null);
    return next();
  }

  const row = res.rows[0];
  c.set('user', {
    id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    sessionId: row.session_id,
  });

  return next();
}

export async function requireAuth(c: Context, next: Next) {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'NOT_AUTHENTICATED', message: 'Veuillez vous connecter.' }, 401);
  }
  return next();
}

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'NOT_AUTHENTICATED', message: 'Veuillez vous connecter.' }, 401);
  }
  if (user.role !== 'admin') {
    return c.json({ error: 'FORBIDDEN', message: 'Accès réservé à la direction.' }, 403);
  }
  return next();
}
