import crypto from 'node:crypto';
import { SignJWT, exportJWK, importJWK, jwtVerify, type JWK } from 'jose';

const SCRYPT_KEYLEN = 64;

export const LEASE_JWT_ISSUER = 'auto-ecole-la-marseillaise-api';
export const LEASE_JWT_AUDIENCE = 'auto-ecole-la-marseillaise-pwa';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (storedBuf.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(storedBuf, derivedKey);
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateOtpCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function normalizeCameroonPhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (/^\+237[26][0-9]{8}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^237[26][0-9]{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^[26][0-9]{8}$/.test(cleaned)) {
    return `+237${cleaned}`;
  }
  return cleaned;
}

/**
 * E11 — Asymmetric Ed25519 keypair for signing offline lease tokens.
 * The private key remains strictly server-side; clients verify leases offline using ONLY the public JWK.
 * Supports explicit PEM injection (`JWT_OFFLINE_LEASE_PRIVATE_KEY_PEM`) or deterministic derivation
 * from `JWT_OFFLINE_LEASE_SECRET` / `BETTER_AUTH_SECRET` via PKCS#8 Ed25519 seed encoding.
 */
let cachedKeyPair: {
  kid: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  publicKeyJwk: JWK;
  secretFingerprint: string;
} | null = null;

async function getLeaseKeyMaterial() {
  const rawMaterial =
    process.env.JWT_OFFLINE_LEASE_PRIVATE_KEY_PEM ||
    process.env.JWT_OFFLINE_LEASE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    'dev-fallback-secret-do-not-use-in-prod-64-chars-long-minimum-key';

  const secretFingerprint = sha256Hex(rawMaterial);
  if (cachedKeyPair && cachedKeyPair.secretFingerprint === secretFingerprint) {
    return cachedKeyPair;
  }

  let privateKey: crypto.KeyObject;
  if (rawMaterial.includes('BEGIN PRIVATE KEY')) {
    privateKey = crypto.createPrivateKey(rawMaterial);
  } else {
    // Deterministic 32-byte Ed25519 seed wrapped in standard RFC 8410 PKCS#8 DER prefix
    const seed32 = crypto.createHash('sha256').update(`aem-ed25519-lease-key:${rawMaterial}`).digest();
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const pkcs8Der = Buffer.concat([pkcs8Prefix, seed32]);
    privateKey = crypto.createPrivateKey({
      key: pkcs8Der,
      format: 'der',
      type: 'pkcs8',
    });
  }

  const publicKey = crypto.createPublicKey(privateKey);
  const exported = await exportJWK(publicKey);
  // Ensure no private parameter ('d') is ever present in public JWK
  const { d: _omitted, ...safePublicJwk } = exported as JWK & { d?: string };
  const kid = `aem-ed25519-${sha256Hex(String(safePublicJwk.x || '')).slice(0, 12)}`;

  const publicKeyJwk: JWK = {
    ...safePublicJwk,
    kid,
    alg: 'EdDSA',
    use: 'sig',
  };

  cachedKeyPair = {
    kid,
    privateKey,
    publicKey,
    publicKeyJwk,
    secretFingerprint,
  };
  return cachedKeyPair;
}

export async function getLeasePublicKeyInfo(): Promise<{
  kid: string;
  alg: 'EdDSA';
  issuer: string;
  audience: string;
  publicKeyJwk: JWK;
}> {
  const { kid, publicKeyJwk } = await getLeaseKeyMaterial();
  return {
    kid,
    alg: 'EdDSA',
    issuer: LEASE_JWT_ISSUER,
    audience: LEASE_JWT_AUDIENCE,
    publicKeyJwk,
  };
}

export interface OfflineLeasePayload {
  sub: string;
  studentId: string | null;
  role: 'admin' | 'student';
  hasAccess: boolean;
  hasPaid: boolean;
  trialEndsAt: string | null;
  serverTimeMs: number;
  maxOfflineUntilMs: number;
}

export async function signOfflineLeaseToken(payload: OfflineLeasePayload): Promise<string> {
  const { kid, privateKey } = await getLeaseKeyMaterial();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
    .setIssuer(LEASE_JWT_ISSUER)
    .setAudience(LEASE_JWT_AUDIENCE)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('14d')
    .sign(privateKey);
}

export async function verifyOfflineLeaseToken(
  token: string,
  customPublicKeyJwk?: JWK
): Promise<OfflineLeasePayload> {
  const verificationKey = customPublicKeyJwk
    ? await importJWK(customPublicKeyJwk, 'EdDSA')
    : (await getLeaseKeyMaterial()).publicKey;

  const { payload } = await jwtVerify(token, verificationKey, {
    issuer: LEASE_JWT_ISSUER,
    audience: LEASE_JWT_AUDIENCE,
    algorithms: ['EdDSA'],
  });
  return payload as unknown as OfflineLeasePayload;
}

export interface OfflineLeaseEvaluationResult {
  valid: boolean;
  allowProtectedContent: boolean;
  allowProfileAndPayments: boolean;
  reason:
    | 'OK'
    | 'MISSING_TOKEN'
    | 'INVALID_SIGNATURE'
    | 'USER_MISMATCH'
    | 'CLOCK_ROLLBACK_DETECTED'
    | 'OFFLINE_LEASE_EXPIRED'
    | 'ACCESS_EXPIRED';
  payload?: OfflineLeasePayload;
}

/**
 * E11 — Evaluates an offline lease token using asymmetric public-key verification,
 * enforcing account binding, clock-rollback detection, bounded offline window, and access rules.
 */
export async function evaluateOfflineLease(
  token: string | null | undefined,
  options: {
    expectedUserId: string;
    deviceNowMs?: number;
    lastTrustedTimeMs?: number;
    publicKeyJwk?: JWK;
    maxClockSkewMs?: number;
  }
): Promise<OfflineLeaseEvaluationResult> {
  if (!token) {
    return {
      valid: false,
      allowProtectedContent: false,
      allowProfileAndPayments: true,
      reason: 'MISSING_TOKEN',
    };
  }

  let payload: OfflineLeasePayload;
  try {
    payload = await verifyOfflineLeaseToken(token, options.publicKeyJwk);
  } catch {
    return {
      valid: false,
      allowProtectedContent: false,
      allowProfileAndPayments: true,
      reason: 'INVALID_SIGNATURE',
    };
  }

  if (!payload.sub || payload.sub !== options.expectedUserId) {
    return {
      valid: false,
      allowProtectedContent: false,
      allowProfileAndPayments: false,
      reason: 'USER_MISMATCH',
      payload,
    };
  }

  const deviceNowMs = options.deviceNowMs ?? Date.now();
  const maxClockSkewMs = options.maxClockSkewMs ?? 5 * 60_000; // 5 minutes tolerance
  const highWaterMarkMs = Math.max(payload.serverTimeMs, options.lastTrustedTimeMs ?? 0);

  if (deviceNowMs + maxClockSkewMs < highWaterMarkMs) {
    return {
      valid: false,
      allowProtectedContent: false,
      allowProfileAndPayments: true,
      reason: 'CLOCK_ROLLBACK_DETECTED',
      payload,
    };
  }

  if (deviceNowMs > payload.maxOfflineUntilMs) {
    return {
      valid: false,
      allowProtectedContent: false,
      allowProfileAndPayments: true,
      reason: 'OFFLINE_LEASE_EXPIRED',
      payload,
    };
  }

  if (!payload.hasAccess) {
    return {
      valid: false,
      allowProtectedContent: false,
      allowProfileAndPayments: true,
      reason: 'ACCESS_EXPIRED',
      payload,
    };
  }

  return {
    valid: true,
    allowProtectedContent: true,
    allowProfileAndPayments: true,
    reason: 'OK',
    payload,
  };
}
