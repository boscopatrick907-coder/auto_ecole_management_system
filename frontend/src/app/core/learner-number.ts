/**
 * Frontend school-specific learner-number display configuration.
 * Numeric student_number values are always passed through unchanged.
 */
export const LEARNER_NUMBER_PREFIXES: Readonly<Record<string, string>> = {
  "la-marseillaise": "LM",
};

const defaultPrefix = "LM";

export function learnerNumberLabel(
  schoolSlug: string,
  studentNumber: number,
  apiPrefix?: string | null,
): string {
  const configuredPrefix = LEARNER_NUMBER_PREFIXES[schoolSlug];
  const schoolPrefix = apiPrefix?.trim().toUpperCase();
  const prefix = configuredPrefix || schoolPrefix || defaultPrefix;

  return `#${prefix}-${studentNumber}`;
}
