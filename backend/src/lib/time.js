import { env } from "../config/env.js";

// Small time-zone helpers built on Intl, so room slots and charts follow the SAC's local clock
// whatever time zone the server runs in.

const partsFormatter = (timeZone) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const formatterCache = new Map();
const formatterFor = (timeZone) => {
  if (!formatterCache.has(timeZone)) formatterCache.set(timeZone, partsFormatter(timeZone));
  return formatterCache.get(timeZone);
};

/** Wall-clock parts of `date` in `timeZone` */
export const zonedParts = (date, timeZone = env.APP_TIMEZONE) => {
  const out = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) {
    if (type !== "literal") out[type] = Number(value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
};

/** Offset of `timeZone` from UTC at `date`, in milliseconds */
const offsetAt = (date, timeZone) => {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** The instant at which the wall clock in `timeZone` reads the given date and time */
export const zonedTimeToDate = ({ year, month, day, hour = 0, minute = 0 }, timeZone = env.APP_TIMEZONE) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(new Date(guess), timeZone);
  // Re-check once in case the guess and the answer fall on different sides of a DST change
  return new Date(guess - offsetAt(new Date(first), timeZone));
};

/** "YYYY-MM-DD" for `date` in `timeZone` */
export const toDateKey = (date, timeZone = env.APP_TIMEZONE) => {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** Parse "YYYY-MM-DD" into its parts */
export const parseDateKey = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

/** Start of the local day (midnight) containing `date` */
export const startOfLocalDay = (date, timeZone = env.APP_TIMEZONE) => {
  const p = zonedParts(date, timeZone);
  return zonedTimeToDate({ year: p.year, month: p.month, day: p.day }, timeZone);
};

/** Start of the local clock hour containing `date`. Not a UTC floor: India is UTC+5:30, so the two differ. */
export const startOfLocalHour = (date, timeZone = env.APP_TIMEZONE) => {
  const p = zonedParts(date, timeZone);
  return zonedTimeToDate({ year: p.year, month: p.month, day: p.day, hour: p.hour }, timeZone);
};

/** "6:30 PM" in the SAC's time zone, for notification text */
export const formatClock = (date, timeZone = env.APP_TIMEZONE) =>
  new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toUpperCase();

/** "Sat 11 Oct, 6:00 PM" in the SAC's time zone */
export const formatDayClock = (date, timeZone = env.APP_TIMEZONE) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
