// A minimal stand-in for Foundation's Calendar: day, week and month arithmetic in local time or
// UTC, with a configurable first weekday. Pure; no DOM.

export type Calendar = {
  /** "local" follows the runtime's time zone (DST-aware); "UTC" keeps tests machine-independent. */
  timeZone: "local" | "UTC";
  /** 1 = Sunday, 2 = Monday, … 7 = Saturday, as in Foundation. */
  firstWeekday: number;
};

export const localCalendar = (firstWeekday = 1): Calendar => ({ timeZone: "local", firstWeekday });

type Fields = { year: number; month: number; day: number };

function fields(calendar: Calendar, date: Date): Fields & { weekday: number } {
  return calendar.timeZone === "UTC"
    ? { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), weekday: date.getUTCDay() + 1 }
    : { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), weekday: date.getDay() + 1 };
}

/** Midnight of the given day; out-of-range months and days roll over like `Date`. */
function midnight(calendar: Calendar, { year, month, day }: Fields): Date {
  return calendar.timeZone === "UTC" ? new Date(Date.UTC(year, month, day)) : new Date(year, month, day);
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export const startOfDay = (calendar: Calendar, date: Date) => midnight(calendar, fields(calendar, date));

/** Midnight `days` days after the day containing `date`. */
export function addDays(calendar: Calendar, date: Date, days: number): Date {
  const f = fields(calendar, date);
  return midnight(calendar, { ...f, day: f.day + days });
}

/** Midnight `months` months after the day containing `date`, clamping the day to the target month's length. */
export function addMonths(calendar: Calendar, date: Date, months: number): Date {
  const f = fields(calendar, date);
  const target = new Date(Date.UTC(f.year, f.month + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  return midnight(calendar, { year, month, day: Math.min(f.day, daysInMonth(year, month)) });
}

export function startOfWeek(calendar: Calendar, date: Date): Date {
  const f = fields(calendar, date);
  return midnight(calendar, { ...f, day: f.day - ((f.weekday - calendar.firstWeekday + 7) % 7) });
}

export function startOfMonth(calendar: Calendar, date: Date): Date {
  return midnight(calendar, { ...fields(calendar, date), day: 1 });
}

export const isSameDay = (calendar: Calendar, a: Date, b: Date) => startOfDay(calendar, a).getTime() === startOfDay(calendar, b).getTime();

/** Foundation-style first weekday (1 = Sunday) for a BCP 47 locale, defaulting to Sunday. */
export function firstWeekdayFor(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const firstDay = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    // Intl numbers days 1 = Monday … 7 = Sunday.
    return firstDay ? (firstDay % 7) + 1 : 1;
  } catch {
    return 1;
  }
}
