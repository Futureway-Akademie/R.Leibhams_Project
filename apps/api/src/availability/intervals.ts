// Rechnen mit halboffenen Zeitintervallen [start, end) in Millisekunden.

export interface Interval {
  start: number;
  end: number;
}

/** Sortiert und vereinigt überlappende oder direkt angrenzende Intervalle. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Entfernt alle Bereiche von `remove` aus `from`. */
export function subtractIntervals(
  from: readonly Interval[],
  remove: readonly Interval[],
): Interval[] {
  let result = mergeIntervals(from);
  for (const cut of mergeIntervals(remove)) {
    result = result.flatMap((interval) => {
      if (cut.end <= interval.start || cut.start >= interval.end) return [interval];
      const parts: Interval[] = [];
      if (cut.start > interval.start) parts.push({ start: interval.start, end: cut.start });
      if (cut.end < interval.end) parts.push({ start: cut.end, end: interval.end });
      return parts;
    });
  }
  return result;
}

/** Schneidet Intervalle auf den Bereich `bounds` zu. */
export function clipIntervals(intervals: readonly Interval[], bounds: Interval): Interval[] {
  return intervals
    .map((i) => ({ start: Math.max(i.start, bounds.start), end: Math.min(i.end, bounds.end) }))
    .filter((i) => i.end > i.start);
}
