export type AgeMode = '5-8' | '8-12' | '12-16';

export const AGE_MODES: AgeMode[] = ['5-8', '8-12', '12-16'];

/**
 * The spec's bands overlap at 8 and 12. The older mode wins there: pushing a
 * kid who has just turned 12 back into the 8-12 screens reads as a demotion,
 * and a parent can always override per kid.
 *
 * The override comes from a Firestore document, so it is untrusted input: an
 * unrecognised value must fall back to the birth-year band rather than be
 * returned verbatim, or it reaches `data-age-mode`, matches no token block,
 * and silently degrades to the 8-12 baseline with no way to notice.
 */
export function ageModeFor(
  birthYear: number,
  override?: AgeMode | null,
  today: Date = new Date(),
): AgeMode {
  if (override && AGE_MODES.includes(override)) return override;
  const age = today.getUTCFullYear() - birthYear;
  if (age >= 12) return '12-16';
  if (age >= 8) return '8-12';
  return '5-8';
}
