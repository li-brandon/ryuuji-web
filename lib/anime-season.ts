/** Calendar quarters matching the macOS AnimeSeason domain rules. */
export type Quarter = "winter" | "spring" | "summer" | "fall";
const quarters: Quarter[] = ["winter", "spring", "summer", "fall"];
const labels: Record<Quarter, string> = { winter: "Winter", spring: "Spring", summer: "Summer", fall: "Fall" };

export class AnimeSeason {
  constructor(readonly year: number, readonly quarter: Quarter) {}

  static current(now = new Date()): AnimeSeason {
    return new AnimeSeason(now.getFullYear(), quarters[Math.floor(now.getMonth() / 3)] ?? "winter");
  }

  static parse(value: string | null): AnimeSeason | null {
    const match = /^(winter|spring|summer|fall)-(\d{4})$/.exec(value ?? "");
    const quarter = quarters.find((q) => q === match?.[1]);
    return match && quarter && Number(match[2]) > 0 ? new AnimeSeason(Number(match[2]), quarter) : null;
  }

  get next(): AnimeSeason {
    return this.quarter === "fall" ? new AnimeSeason(this.year + 1, "winter") : new AnimeSeason(this.year, quarters[quarters.indexOf(this.quarter) + 1] ?? "winter");
  }

  get previous(): AnimeSeason {
    return this.quarter === "winter" ? new AnimeSeason(this.year - 1, "fall") : new AnimeSeason(this.year, quarters[quarters.indexOf(this.quarter) - 1] ?? "fall");
  }

  get label(): string { return `${labels[this.quarter]} ${this.year}`; }
  get slug(): string { return `${this.quarter}-${String(this.year).padStart(4, "0")}`; }
  get firstDay(): string { return this.date(quarters.indexOf(this.quarter) * 3 + 1, 1); }
  get lastDay(): string {
    const month = quarters.indexOf(this.quarter) * 3 + 3;
    return this.date(month, month === 6 || month === 9 ? 30 : 31);
  }
  contains(date: string | null | undefined): boolean {
    return !!date && date >= this.firstDay && date <= this.lastDay;
  }
  private date(month: number, day: number): string {
    return `${String(this.year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
}
