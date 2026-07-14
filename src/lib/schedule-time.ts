// Timezone conversion for scheduled publishing. The DB stores scheduled_publish_at
// as a UTC instant; the operator enters a wall-clock date+time in an EXPLICIT IANA
// zone. This converts that zoned wall clock to the correct UTC instant, DST-aware
// and without any silent browser-local assumption.

/**
 * Convert a wall-clock `date` (YYYY-MM-DD) + `time` (HH:mm) interpreted in
 * `timeZone` to a UTC ISO instant. DST is handled because the zone offset is
 * computed at the target instant, not assumed.
 */
export function zonedWallClockToUtcIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) throw new Error("Invalid date/time.");
  // Start by pretending the wall clock is UTC, then correct by the zone's offset
  // at that instant (offset = what the zone shows minus the UTC guess).
  const asUtcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(asUtcGuess))) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  const shownAsUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute);
  const offsetMs = shownAsUtc - asUtcGuess;
  return new Date(asUtcGuess - offsetMs).toISOString();
}
