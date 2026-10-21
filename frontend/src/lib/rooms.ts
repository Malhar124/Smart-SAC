import { parseDateKey, zonedTimeToDate } from "@/lib/time";
import type { Room, RoomBooking } from "@/lib/types";

export type SlotState = "free" | "mine" | "taken" | "past" | "closed";

export interface Slot {
  hour: number;
  startsAt: Date;
  endsAt: Date;
  state: SlotState;
  booking: RoomBooking | null;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * One room's hourly slots for a day: free, yours, taken by someone else, already over, or closed.
 * A slot whose hour has started but not ended still counts as bookable (matching the server).
 */
export const buildSlots = (room: Room, dateKey: string, openHour: number, closeHour: number, now = new Date()): Slot[] => {
  const day = parseDateKey(dateKey);
  const slots: Slot[] = [];
  for (let hour = openHour; hour < closeHour; hour += 1) {
    const startsAt = zonedTimeToDate({ ...day, hour });
    const endsAt = new Date(startsAt.getTime() + HOUR_MS);
    const booking =
      room.bookings.find((b) => new Date(b.startsAt).getTime() < endsAt.getTime() && new Date(b.endsAt).getTime() > startsAt.getTime()) ?? null;
    let state: SlotState;
    if (booking) state = booking.mine ? "mine" : "taken";
    else if (room.status === "maintenance") state = "closed";
    else if (endsAt.getTime() <= now.getTime()) state = "past";
    else state = "free";
    slots.push({ hour, startsAt, endsAt, state, booking });
  }
  return slots;
};

/** How many consecutive hours, up to `max`, can be booked starting at `index` */
export const bookableHours = (slots: Slot[], index: number, max: number) => {
  let hours = 0;
  for (let i = index; i < slots.length && hours < max; i += 1) {
    if (slots[i].state !== "free") break;
    hours += 1;
  }
  return hours;
};
