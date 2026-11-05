import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const SCRYPT_KEYLEN = 64;

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

function getLeaseSecretKey(): Uint8Array {
  const secret =
    process.env.JWT_OFFLINE_LEASE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    'dev-fallback-secret-do-not-use-in-prod-64-chars-long-minimum-key';
  return new TextEncoder().encode(secret);
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
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getLeaseSecretKey());
}

export async function verifyOfflineLeaseToken(token: string): Promise<OfflineLeasePayload> {
  const { payload } = await jwtVerify(token, getLeaseSecretKey());
  return payload as unknown as OfflineLeasePayload;
}
