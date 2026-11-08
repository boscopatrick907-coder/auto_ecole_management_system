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

// 2. CORS Configuration
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || 'http://localhost:4200',
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
