import { onlinePaymentRoutes } from './routes/online-payments.js';
import { operationsRoutes } from './routes/operations.js';
import { bodyLimit } from 'hono/body-limit';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware/auth.js';
import { authPayloadAndRateLimitMiddleware } from './middleware/auth-rate-limit.js';
import { authRoutes } from './routes/auth.js';
import { studentRoutes } from './routes/student.js';
import { adminRoutes } from './routes/admin.js';
import { ApiError } from './utils/validation.js';

export const app = new Hono();

// 1. Security Headers (OWASP Best Practices)
app.use('*', secureHeaders());
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ error: 'BODY_TOO_LARGE', message: 'Requête trop volumineuse.' }, 413) }));
const trustedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200,http://127.0.0.1:4200').split(',').map(s => s.trim());

// 2. CORS Configuration
app.use(
  '/api/*',
  cors({
    origin: (origin) => trustedOrigins.includes(origin) ? origin : undefined,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Client-Device-Id'],
    credentials: true,
  })
);

// 3. Auth Payload Shape & Rate Limit Guard (E06)
app.use('/api/auth/*', authPayloadAndRateLimitMiddleware);

// 4. Global Session Authentication Middleware
app.use('/api/*', authMiddleware);

// 5. Health Check
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'Auto-école La Marseillaise API (Neon Serverless PostgreSQL)',
    serverTime: new Date().toISOString(),
  })
);

// 6. Mount Modular Routes
app.route('/api/auth', authRoutes);
app.route('/api/student', studentRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/operations', operationsRoutes);
app.route('/api/payments', onlinePaymentRoutes);

// 7. Centralized Error Handler (E08 — Never leaks SQL, stack traces, or credentials)
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        error: err.code,
        message: err.message,
      },
      err.status
    );
  }

  const pgCode = (err as any)?.code;
  if (pgCode === '23P01') return c.json({ error: 'SCHEDULE_CONFLICT', message: 'Moniteur ou véhicule déjà affecté.' },409);
  if (pgCode === '23505') return c.json({ error: 'DUPLICATE_RECORD', message: 'Enregistrement déjà existant.' },409);
  if (pgCode === '23503' || pgCode === '23514') return c.json({ error: 'VALIDATION_ERROR', message: 'Référence ou valeur invalide.' },400);
  if (pgCode === '42501') return c.json({ error: 'FORBIDDEN', message: 'Accès non autorisé.' },403);
  if (['INVALID_INSTRUCTOR','INACTIVE_VEHICLE','STUDENT_NOT_IN_SESSION','CORRECTION_REASON_REQUIRED','CAPACITY_BELOW_OCCUPANCY'].includes(err.message)) return c.json({error:err.message,message:'Règle métier non respectée.'},400);
  // PostgreSQL 22P02 = invalid_text_representation (e.g. invalid UUID syntax)
  // PostgreSQL 22007 / 22008 = invalid_datetime_format / datetime_field_overflow
  if (pgCode === '22P02' || pgCode === '22007' || pgCode === '22008') {
    return c.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'Paramètre ou format de données invalide.',
      },
      400
    );
  }

  console.error('[API Error]:', err.message);
  return c.json(
    {
      error: 'INTERNAL_SERVER_ERROR',
      message: "Une erreur interne s'est produite.",
    },
    500
  );
});
