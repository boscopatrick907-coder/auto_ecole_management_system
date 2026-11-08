import { z } from 'zod';

export class ApiError extends Error {
  public readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500;
  public readonly code: string;

  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 429 | 500,
    code: string,
    message: string
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Validates that a string is a strict YYYY-MM-DD calendar date and that the
 * year, month, and day actually exist on the Gregorian calendar (including leap years).
 */
export function isValidIsoCalendarDate(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1970 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeapYear) {
    daysInMonths[1] = 29;
  }

  return day >= 1 && day <= daysInMonths[month - 1];
}

export const isoCalendarDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoCalendarDate, {
    message: 'Date calendrier invalide (format attendu YYYY-MM-DD réel).',
  });

export const MAX_SAFE_FCFA_AMOUNT = 1_000_000_000; // 1 billion FCFA safe bound

export const safePositiveMoneySchema = z
  .number()
  .int('Le montant FCFA doit être un nombre entier.')
  .positive('Le montant FCFA doit être strictement positif.')
  .max(MAX_SAFE_FCFA_AMOUNT, 'Montant FCFA hors limites autorisées.');

export const safeNonNegativeMoneySchema = z
  .number()
  .int('Le montant FCFA doit être un nombre entier.')
  .min(0, 'Le montant FCFA ne peut pas être négatif.')
  .max(MAX_SAFE_FCFA_AMOUNT, 'Montant FCFA hors limites autorisées.');

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}
