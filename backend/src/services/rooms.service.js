import { prisma } from "../db/index.js";
import { ApiError } from "../utils/ApiError.js";
import { publish } from "../lib/events.js";
import { notify } from "./notifications.service.js";
import { env } from "../config/env.js";
import { formatDayClock, parseDateKey, startOfLocalDay, startOfLocalHour, toDateKey, zonedParts, zonedTimeToDate } from "../lib/time.js";
import {
  DAY,
  HOUR,
  ROOM_BOOKING_DAYS_AHEAD,
  ROOM_MAX_HOURS_PER_BOOKING,
  ROOM_MAX_UPCOMING_BOOKINGS,
  SAC_CLOSE_HOUR,
  SAC_OPEN_HOUR,
} from "../config/policy.js";

const dayRange = (dateKey) => {
  const start = zonedTimeToDate(parseDateKey(dateKey));
  // Local midnight to local midnight, measured on the wall clock so DST days still line up
  const next = new Date(start.getTime() + 36 * HOUR);
  return { start, end: startOfLocalDay(next) };
};

const bookingInclude = { user: { select: { id: true, fullname: true, roll_no: true } } };

/**
 * Rooms with their bookings for one local day. Students see only whether a slot is taken and
 * which bookings are theirs; staff see who booked.
 */
export const getRoomsForDay = async ({ dateKey, viewerUserId = null, staff = false }) => {
  const { start, end } = dayRange(dateKey);
  const rooms = await prisma.room.findMany({
    orderBy: { name: "asc" },
    include: {
      bookings: {
        where: { cancelledAt: null, startsAt: { lt: end }, endsAt: { gt: start } },
        orderBy: { startsAt: "asc" },
        include: bookingInclude,
      },
    },
  });

  return {
    date: dateKey,
    today: toDateKey(new Date()),
    timeZone: env.APP_TIMEZONE,
    openHour: SAC_OPEN_HOUR,
    closeHour: SAC_CLOSE_HOUR,
    daysAhead: ROOM_BOOKING_DAYS_AHEAD,
    maxHours: ROOM_MAX_HOURS_PER_BOOKING,
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      description: room.description,
      status: room.status,
      bookings: room.bookings.map((b) => ({
        id: b.id,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        mine: b.userId === viewerUserId,
        ...(staff || b.userId === viewerUserId ? { purpose: b.purpose } : {}),
        ...(staff ? { student: { id: b.user.id, name: b.user.fullname, rollNo: b.user.roll_no } } : {}),
      })),
    })),
  };
};

export const listUpcomingBookingsForUser = async (userId, now = new Date()) => {
  const bookings = await prisma.roomBooking.findMany({
    where: { userId, cancelledAt: null, endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    include: { room: { select: { id: true, name: true } } },
  });
  return bookings.map((b) => ({
    id: b.id,
    room: b.room,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    purpose: b.purpose,
  }));
};

/** Book whole-hour slots inside opening hours, up to ROOM_BOOKING_DAYS_AHEAD days ahead */
export const bookRoom = async ({ userId, roomId, startsAt, hours, purpose, now = new Date() }) => {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + hours * HOUR);
  const local = zonedParts(start);

  if (local.minute !== 0 || local.second !== 0) throw new ApiError(400, "Bookings start on the hour.");
  if (local.hour < SAC_OPEN_HOUR || local.hour + hours > SAC_CLOSE_HOUR) {
    throw new ApiError(400, `Rooms can be booked between ${SAC_OPEN_HOUR}:00 and ${SAC_CLOSE_HOUR}:00.`);
  }
  if (end <= now) throw new ApiError(400, "That time has already passed.");
  // The slot that's under way can still be booked
  if (start < startOfLocalHour(now)) throw new ApiError(400, "That time has already passed.");
  if (start.getTime() > startOfLocalDay(now).getTime() + (ROOM_BOOKING_DAYS_AHEAD + 1) * DAY) {
    throw new ApiError(400, `Rooms can be booked up to ${ROOM_BOOKING_DAYS_AHEAD} days ahead.`);
  }

  const booking = await prisma.$transaction(async (tx) => {
    // Serialise bookings per student (their limits span rooms), then per room so two students can't
    // take the same slot. Always in this order, so two bookings can't deadlock.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const locked = await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
    if (locked.length === 0) throw new ApiError(404, "That room doesn't exist.");
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (room.status === "maintenance") throw new ApiError(409, `The ${room.name} is closed for now.`);

    const clash = await tx.roomBooking.findFirst({
      where: { roomId, cancelledAt: null, startsAt: { lt: end }, endsAt: { gt: start } },
    });
    if (clash) throw new ApiError(409, "Someone booked that time a moment ago. Pick another slot.");

    const mine = await tx.roomBooking.findMany({ where: { userId, cancelledAt: null, endsAt: { gt: now } } });
    if (mine.some((b) => b.startsAt < end && b.endsAt > start)) {
      throw new ApiError(409, "You already have a room booked at that time.");
    }
    if (mine.length >= ROOM_MAX_UPCOMING_BOOKINGS) {
      throw new ApiError(409, `You can have ${ROOM_MAX_UPCOMING_BOOKINGS} upcoming bookings at a time. Cancel one first.`);
    }

    return tx.roomBooking.create({
      data: { roomId, userId, startsAt: start, endsAt: end, purpose: purpose || null },
      include: { room: { select: { id: true, name: true } } },
    });
  });

  publish("room.changed", { roomId }, { everyone: true });
  return booking;
};

export const cancelOwnBooking = async ({ bookingId, userId }) => {
  const booking = await prisma.roomBooking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.userId !== userId) throw new ApiError(404, "You don't have that booking.");
  if (booking.cancelledAt) throw new ApiError(409, "That booking is already cancelled.");
  if (booking.endsAt <= new Date()) throw new ApiError(409, "That booking has already ended.");

  await prisma.roomBooking.update({ where: { id: bookingId }, data: { cancelledAt: new Date() } });
  publish("room.changed", { roomId: booking.roomId }, { everyone: true });
};

export const cancelBookingAsStaff = async ({ bookingId, adminId, reason }) => {
  const booking = await prisma.roomBooking.findUnique({ where: { id: bookingId }, include: { room: true } });
  if (!booking) throw new ApiError(404, "That booking doesn't exist.");
  if (booking.cancelledAt) throw new ApiError(409, "That booking is already cancelled.");

  await prisma.roomBooking.update({
    where: { id: bookingId },
    data: { cancelledAt: new Date(), cancelledByAdminId: adminId },
  });
  await notify(booking.userId, {
    type: "room_booking_cancelled",
    title: `Your ${booking.room.name} booking was cancelled`,
    body: `${formatDayClock(booking.startsAt)}. ${reason ? `Reason: ${reason}` : "Book another slot from the Rooms page."}`,
    link: "/student/rooms",
  });
  publish("room.changed", { roomId: booking.roomId }, { everyone: true });
};

export const createRoom = async ({ name, capacity, description }) => {
  const room = await prisma.room.create({ data: { name, capacity, description: description || null } });
  publish("room.changed", { roomId: room.id }, { everyone: true });
  return room;
};

const tellBookersCancelled = (roomName, bookings, why) =>
  Promise.all(
    bookings.map((b) =>
      notify(b.userId, {
        type: "room_booking_cancelled",
        title: `Your ${roomName} booking was cancelled`,
        body: `${formatDayClock(b.startsAt)}. ${why}`,
        link: "/student/rooms",
      })
    )
  );

/** Closing a room (status maintenance) cancels its upcoming bookings and tells the students */
export const updateRoom = async (roomId, changes, adminId) => {
  const before = await prisma.room.findUnique({ where: { id: roomId }, select: { status: true } });
  if (!before) throw new ApiError(404, "That room doesn't exist.");
  // Saved first: bookRoom checks the status under a lock on this row, so no booking can slip in after the cancel
  const room = await prisma.room.update({ where: { id: roomId }, data: changes });

  if (changes.status === "maintenance" && before.status !== "maintenance") {
    const now = new Date();
    const upcoming = await prisma.roomBooking.findMany({
      where: { roomId, cancelledAt: null, endsAt: { gt: now } },
      select: { id: true, userId: true, startsAt: true },
    });
    await prisma.roomBooking.updateMany({
      where: { id: { in: upcoming.map((b) => b.id) } },
      data: { cancelledAt: now, cancelledByAdminId: adminId },
    });
    await tellBookersCancelled(room.name, upcoming, "The room is closed for now. Book another from the Rooms page.");
  }
  publish("room.changed", { roomId }, { everyone: true });
  return room;
};

export const removeRoom = async (roomId) => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { bookings: { where: { cancelledAt: null, endsAt: { gt: new Date() } }, select: { userId: true, startsAt: true } } },
  });
  if (!room) throw new ApiError(404, "That room doesn't exist.");

  await prisma.room.delete({ where: { id: roomId } });
  await tellBookersCancelled(room.name, room.bookings, "The room is no longer available to book.");
  publish("room.changed", { roomId }, { everyone: true });
};
