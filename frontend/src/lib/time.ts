import { SAC_TIME_ZONE } from "@/lib/config";

// Wall-clock conversion in the SAC's time zone (mirrors backend/src/lib/time.js).

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string) => {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  return formatters.get(timeZone)!;
};

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export const zonedParts = (date: Date, timeZone = SAC_TIME_ZONE): WallClock => {
  const out: Record<string, number> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) {
    if (type !== "literal") out[type] = Number(value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
};

const offsetAt = (date: Date, timeZone: string) => {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
};

/** The instant at which the SAC's clock reads the given date and hour */
export const zonedTimeToDate = (
  { year, month, day, hour = 0, minute = 0 }: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone = SAC_TIME_ZONE
) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(new Date(guess), timeZone);
  return new Date(guess - offsetAt(new Date(first), timeZone));
};

export const parseDateKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

/** Date keys for `count` days starting today, on the SAC's calendar */
export const upcomingDateKeys = (count: number, now = new Date(), timeZone = SAC_TIME_ZONE) => {
  const today = zonedParts(now, timeZone);
  return Array.from({ length: count }, (_, i) => {
    // Noon avoids landing on the wrong side of midnight around DST changes
    const d = zonedParts(new Date(zonedTimeToDate({ ...today, hour: 12 }, timeZone).getTime() + i * 86_400_000), timeZone);
    return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  });
};
