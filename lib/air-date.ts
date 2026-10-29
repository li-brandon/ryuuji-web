// Ports the macOS app's AirDate helpers and EpisodeInfo.isAired (Domain/Types.swift).
// Dates are TMDB-style "yyyy-MM-dd" strings, so they compare correctly as strings.

/** Today's calendar date as "yyyy-MM-dd", in `timeZone` (default: the local zone). */
export function today(now: Date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** An episode has aired when its air date is on or before `today`. A missing date is unaired. */
export function isAired(airDate: string | null, today: string): boolean {
  return !!airDate && airDate <= today;
}
