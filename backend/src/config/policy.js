// SAC rules in one place. The frontend mirrors the ones it shows to people (src/lib/policy.ts).

/** Hours the SAC desk and rooms are open, in APP_TIMEZONE. Rooms book in whole hours inside this range. */
export const SAC_OPEN_HOUR = 6;
export const SAC_CLOSE_HOUR = 22;

/** Equipment reservations */
export const RESERVATION_MINUTES = 15;
export const RESERVATION_REMINDER_MINUTES = 5;

/** Loans */
export const LOAN_MIN_MINUTES = 15;
export const LOAN_MAX_MINUTES = 8 * 60;
export const DUE_SOON_MINUTES = 15;
/** Returns within this long after the due time don't count as late */
export const LATE_GRACE_MINUTES = 10;

/** Borrowing block: this many late returns inside the window blocks borrowing for BLOCK_DAYS */
export const LATE_RETURN_WINDOW_DAYS = 30;
export const LATE_RETURN_LIMIT = 3;
export const BLOCK_DAYS = 7;

/** Rooms */
export const ROOM_BOOKING_DAYS_AHEAD = 7;
export const ROOM_MAX_HOURS_PER_BOOKING = 2;
export const ROOM_MAX_UPCOMING_BOOKINGS = 2;
export const ROOM_REMINDER_MINUTES = 15;

/** History rows are kept this long */
export const HISTORY_RETENTION_DAYS = 90;

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
