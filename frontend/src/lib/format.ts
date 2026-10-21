import { formatDistanceToNowStrict } from "date-fns";
import { SAC_TIME_ZONE } from "@/lib/config";

// Times are shown on the SAC's clock (Asia/Kolkata by default), whatever the browser's time zone.

const clockFormat = new Intl.DateTimeFormat("en-IN", { timeZone: SAC_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
const dayFormat = new Intl.DateTimeFormat("en-IN", { timeZone: SAC_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const dateFormat = new Intl.DateTimeFormat("en-IN", { timeZone: SAC_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const keyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: SAC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: SAC_TIME_ZONE, hour: "numeric", hourCycle: "h23" });

const toDate = (value: string | Date) => (typeof value === "string" ? new Date(value) : value);

/** "6:30 pm" -> "6:30 PM" */
export const formatClock = (value: string | Date) => clockFormat.format(toDate(value)).toUpperCase();

/** "Sat, 11 Oct" */
export const formatDay = (value: string | Date) => dayFormat.format(toDate(value));

/** "11 Oct 2026" */
export const formatDate = (value: string | Date) => dateFormat.format(toDate(value));

/** "Sat, 11 Oct, 6:30 PM", or "Today, 6:30 PM" when it's today */
export const formatDayClock = (value: string | Date, now = new Date()) => {
  const date = toDate(value);
  const day = dateKey(date) === dateKey(now) ? "Today" : formatDay(date);
  return `${day}, ${formatClock(date)}`;
};

/** "3 min ago", "in 2 hours" */
export const timeAgo = (value: string | Date) => formatDistanceToNowStrict(toDate(value), { addSuffix: true });

/** "2026-10-11" for the SAC's local date */
export const dateKey = (value: string | Date = new Date()) => keyFormat.format(toDate(value));

/** Local hour (0-23) on the SAC's clock */
export const localHour = (value: string | Date) => Number(hourFormat.format(toDate(value))) % 24;

/** 17 -> "5 PM", 12 -> "12 PM", 0 -> "12 AM" */
export const formatHour = (hour: number) => {
  const h = ((hour + 11) % 12) + 1;
  return `${h} ${hour < 12 || hour === 24 ? "AM" : "PM"}`;
};

/** 90 -> "1 hr 30 min", 45 -> "45 min", 120 -> "2 hr" */
export const formatMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
};

/** "Due 6:30 PM" or "Overdue by 25 min" */
export const formatDue = (dueAt: string | Date, now = new Date()) => {
  const due = toDate(dueAt);
  const diff = Math.round((now.getTime() - due.getTime()) / 60000);
  if (diff > 0) return `Overdue by ${formatMinutes(diff)}`;
  return `Due ${dateKey(due) === dateKey(now) ? formatClock(due) : formatDayClock(due, now)}`;
};

export const STATUS_WORD = { available: "Free", in_use: "Out", broken: "Broken" } as const;

export const TICKET_STATUS_LABEL = { open: "Open", in_process: "In progress", closed: "Closed" } as const;

/** Normalise status strings from older API rows ("in-use", "in_use") */
export const normalizeStatus = (status: string): "available" | "in_use" | "broken" =>
  status === "available" ? "available" : status === "in_use" || status === "in-use" ? "in_use" : "broken";
