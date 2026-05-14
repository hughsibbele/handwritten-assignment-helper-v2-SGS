/**
 * Northern-hemisphere school calendar: academic year runs July → June.
 * July onwards belongs to (year, year+1); January–June belongs to (year-1, year).
 *
 * Returns the four-digit start and end years for the academic year containing `now`.
 */
export function currentAcademicYear(now: Date = new Date()): {
  startYear: number;
  endYear: number;
} {
  const month = now.getMonth(); // 0 = January
  const year = now.getFullYear();
  if (month >= 6) {
    return { startYear: year, endYear: year + 1 };
  }
  return { startYear: year - 1, endYear: year };
}

/**
 * True if the Canvas term string plausibly belongs to the current academic
 * year. Permissive on purpose — Canvas term names are inconsistent across
 * schools ("2025-2026 School Year", "Fall 2025", "Spring 2026", "2025/2026"…).
 *
 * Heuristic: term contains either the start or end year as a four-digit
 * number. Missing/empty term → treat as current (we have no signal to skip on).
 */
export function termIsCurrent(
  term: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!term) return true;
  const { startYear, endYear } = currentAcademicYear(now);
  return term.includes(String(startYear)) || term.includes(String(endYear));
}
