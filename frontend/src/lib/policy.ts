// Mirrors backend/src/config/policy.js for the rules the interface explains to people.
export const RESERVATION_MINUTES = 15;
export const LATE_GRACE_MINUTES = 10;
export const LATE_RETURN_LIMIT = 3;
export const LATE_RETURN_WINDOW_DAYS = 30;
export const BLOCK_DAYS = 7;
export const ROOM_MAX_HOURS_PER_BOOKING = 2;
export const ROOM_MAX_UPCOMING_BOOKINGS = 2;

/** Lend durations offered as one-key presets at the desk, in minutes */
export const LEND_PRESETS = [30, 60, 90, 120] as const;
