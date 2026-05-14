/**
 * Sort key for "what should the student/teacher see first?" — distance from
 * today, with a tiny bias so a just-passed assignment edges out a same-distance
 * upcoming one (the "you might have missed this" prompt is more urgent than
 * the "this is coming up" prompt at equal lag).
 *
 * No due date → sorts last.
 */
export function proximityKey(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!dueDate) return Number.MAX_SAFE_INTEGER;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return Number.MAX_SAFE_INTEGER;
  const days = Math.floor((due - now.getTime()) / 86_400_000);
  return Math.abs(days) * 2 + (days > 0 ? 1 : 0);
}

export function sortByProximity<T extends { due_date: string | null }>(
  items: T[],
  now: Date = new Date(),
): T[] {
  return [...items].sort(
    (a, b) => proximityKey(a.due_date, now) - proximityKey(b.due_date, now),
  );
}
