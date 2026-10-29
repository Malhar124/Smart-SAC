import cron from "node-cron";
import { prisma } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { publish } from "../lib/events.js";
import { formatClock } from "../lib/time.js";
import { notify } from "../services/notifications.service.js";
import { announceEquipmentChange } from "../services/equipment.service.js";
import {
  DAY,
  DUE_SOON_MINUTES,
  MINUTE,
  NOTIFICATION_RETENTION_DAYS,
  RESERVATION_REMINDER_MINUTES,
  ROOM_REMINDER_MINUTES,
} from "../config/policy.js";

// Every reminder is "claimed" with a conditional update before it is sent, so a job that overlaps
// itself (or a second backend instance) never sends the same notification twice.

const claim = async (model, id, field) => {
  const { count } = await prisma[model].updateMany({ where: { id, [field]: null }, data: { [field]: new Date() } });
  return count === 1;
};

/** Holds ending within RESERVATION_REMINDER_MINUTES get one reminder */
const remindExpiringHolds = async (now) => {
  const items = await prisma.equipment.findMany({
    where: {
      status: "available",
      reservedById: { not: null },
      reservationRemindedAt: null,
      reservedUntil: { gt: now, lte: new Date(now.getTime() + RESERVATION_REMINDER_MINUTES * MINUTE) },
    },
    select: { id: true, name: true, reservedById: true, reservedUntil: true },
  });
  for (const item of items) {
    if (!(await claim("equipment", item.id, "reservationRemindedAt"))) continue;
    await notify(item.reservedById, {
      type: "reservation_expiring",
      title: `Your hold on the ${item.name} ends at ${formatClock(item.reservedUntil)}`,
      body: "Collect it from the SAC desk before then, or cancel so someone else can have it.",
      link: "/student/dashboard",
    });
  }
  return items.length;
};

/** Expired holds are cleared and the student told, so the rack shows the item as free again */
const clearExpiredHolds = async (now) => {
  const items = await prisma.equipment.findMany({
    where: { reservedById: { not: null }, reservedUntil: { lte: now } },
    select: { id: true, name: true, reservedById: true, status: true },
  });
  for (const item of items) {
    const { count } = await prisma.equipment.updateMany({
      where: { id: item.id, reservedById: item.reservedById, reservedUntil: { lte: now } },
      data: { reservedById: null, reservedUntil: null, reservationRemindedAt: null },
    });
    if (count === 0 || item.status !== "available") continue;
    await notify(item.reservedById, {
      type: "reservation_expired",
      title: `Your hold on the ${item.name} ended`,
      body: "It wasn't collected in time. Reserve it again if it's still free.",
      link: "/student/dashboard",
    });
  }
  if (items.length > 0) announceEquipmentChange(null, items.map((i) => i.reservedById));
  return items.length;
};

/** Loans due within DUE_SOON_MINUTES get one reminder (only students with an account can be told) */
const remindDueSoon = async (now) => {
  const loans = await prisma.loan.findMany({
    where: {
      returnedAt: null,
      userId: { not: null },
      dueSoonNotifiedAt: null,
      dueAt: { gt: now, lte: new Date(now.getTime() + DUE_SOON_MINUTES * MINUTE) },
    },
    select: { id: true, userId: true, dueAt: true, equipment: { select: { name: true } } },
  });
  for (const loan of loans) {
    if (!(await claim("loan", loan.id, "dueSoonNotifiedAt"))) continue;
    await notify(loan.userId, {
      type: "due_soon",
      title: `The ${loan.equipment.name} is due back at ${formatClock(loan.dueAt)}`,
      body: "Return it to the SAC desk on time to keep borrowing.",
      link: "/student/profile",
    });
  }
  return loans.length;
};

/** Loans that just went overdue: the student is told once and the desk dashboard refreshes */
const flagOverdue = async (now) => {
  const loans = await prisma.loan.findMany({
    where: { returnedAt: null, overdueNotifiedAt: null, dueAt: { lte: now } },
    select: { id: true, userId: true, dueAt: true, equipment: { select: { name: true } } },
  });
  for (const loan of loans) {
    if (!(await claim("loan", loan.id, "overdueNotifiedAt"))) continue;
    if (loan.userId) {
      await notify(loan.userId, {
        type: "overdue",
        title: `The ${loan.equipment.name} is overdue`,
        body: `It was due at ${formatClock(loan.dueAt)}. Return it to the SAC desk; you can't borrow anything else until you do.`,
        link: "/student/profile",
      });
    }
  }
  if (loans.length > 0) announceEquipmentChange(null, loans.map((l) => l.userId));
  return loans.length;
};

const remindRoomBookings = async (now) => {
  const bookings = await prisma.roomBooking.findMany({
    where: {
      cancelledAt: null,
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date(now.getTime() + ROOM_REMINDER_MINUTES * MINUTE) },
    },
    select: { id: true, userId: true, startsAt: true, room: { select: { name: true } } },
  });
  for (const booking of bookings) {
    if (!(await claim("roomBooking", booking.id, "reminderSentAt"))) continue;
    await notify(booking.userId, {
      type: "room_booking_soon",
      title: `Your ${booking.room.name} booking starts at ${formatClock(booking.startsAt)}`,
      body: "Cancel it from the Rooms page if you no longer need it.",
      link: "/student/rooms",
    });
  }
  return bookings.length;
};

/** One pass of every reminder. Exported so tests can run it with a fixed clock. */
export const runReminders = async (now = new Date()) => ({
  holdsReminded: await remindExpiringHolds(now),
  holdsCleared: await clearExpiredHolds(now),
  dueSoon: await remindDueSoon(now),
  overdue: await flagOverdue(now),
  roomsReminded: await remindRoomBookings(now),
});

/**
 * Deletes rows past their retention date (announcements, history, sessions, notifications older than
 * NOTIFICATION_RETENTION_DAYS; each announcement adds one per student) and sign-ups never confirmed
 */
export const runCleanup = async (now = new Date()) => {
  const [announcements, history, unconfirmed, sessions, notifications] = await Promise.all([
    prisma.announcement.deleteMany({ where: { expireAt: { lte: now } } }),
    prisma.equipmentHistory.deleteMany({ where: { expireAt: { lte: now } } }),
    prisma.user.deleteMany({ where: { isVerified: false, emailVerificationExpires: { lte: now } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.notification.deleteMany({ where: { createdAt: { lte: new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY) } } }),
  ]);
  if (announcements.count > 0) publish("announcement.changed", {}, { everyone: true });
  return {
    announcements: announcements.count,
    history: history.count,
    unconfirmedAccounts: unconfirmed.count,
    sessions: sessions.count,
    notifications: notifications.count,
  };
};

const tasks = [];
let reminderRunning = false;

export const startJobs = () => {
  tasks.push(
    cron.schedule("* * * * *", async () => {
      if (reminderRunning) return;
      reminderRunning = true;
      try {
        const result = await runReminders();
        if (Object.values(result).some(Boolean)) logger.info(result, "reminders sent");
      } catch (err) {
        logger.error({ err }, "reminder job failed");
      } finally {
        reminderRunning = false;
      }
    }),
    cron.schedule("0 * * * *", async () => {
      try {
        const result = await runCleanup();
        logger.info(result, "expired records cleaned up");
      } catch (err) {
        logger.error({ err }, "cleanup job failed");
      }
    })
  );
};

export const stopJobs = () => {
  for (const task of tasks.splice(0)) task.stop();
};
