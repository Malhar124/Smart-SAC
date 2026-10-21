import { prisma } from "../db/index.js";
import { ApiError } from "../utils/ApiError.js";
import { publish } from "../lib/events.js";
import { formatClock } from "../lib/time.js";
import { normalizeRollNo } from "../utils/auth.js";
import { notify } from "./notifications.service.js";
import { getStanding } from "./standing.service.js";
import { DAY, HISTORY_RETENTION_DAYS, LATE_GRACE_MINUTES, MINUTE, RESERVATION_MINUTES } from "../config/policy.js";

const historyExpiry = (now) => new Date(now.getTime() + HISTORY_RETENTION_DAYS * DAY);

const findUserByRoll = (db, rollNo) =>
  db.user.findFirst({
    where: { roll_no: { equals: rollNo, mode: "insensitive" } },
    select: { id: true, fullname: true, roll_no: true, phone_number: true },
  });

/** Lock the equipment row for the rest of the transaction so two desks can't act on it at once */
const lockEquipment = async (tx, equipmentId) => {
  const rows = await tx.$queryRaw`SELECT id FROM "Equipment" WHERE id = ${equipmentId} FOR UPDATE`;
  if (rows.length === 0) throw new ApiError(404, "That item doesn't exist.");
  return tx.equipment.findUnique({
    where: { id: equipmentId },
    include: { reservedBy: { select: { id: true, fullname: true, roll_no: true } } },
  });
};

/** A free item's hold counts only until reservedUntil */
export const liveHold = (item, now = new Date()) =>
  item.status === "available" && item.reservedById && item.reservedUntil && item.reservedUntil > now
    ? { userId: item.reservedById, until: item.reservedUntil, user: item.reservedBy ?? null }
    : null;

const blockedError = (standing) =>
  new ApiError(409, standing.message, [
    { code: "BORROWING_BLOCKED", reason: standing.reason, blockedUntil: standing.blockedUntil, message: standing.message },
  ]);

// ---------------------------------------------------------------- views

const equipmentInclude = {
  games: { select: { id: true, name: true } },
  user: { select: { id: true, fullname: true, phone_number: true } },
  reservedBy: { select: { id: true, fullname: true, roll_no: true } },
};

const baseView = (item, now) => ({
  id: item.id,
  name: item.name,
  status: item.status,
  games: item.games ?? [],
  holder:
    item.status === "in_use"
      ? { name: item.user?.fullname ?? null, rollNo: item.roll_no, phone: item.user?.phone_number ?? null }
      : null,
  issuedAt: item.status === "in_use" ? item.issuedAt : null,
  dueAt: item.status === "in_use" ? item.dueAt : null,
  overdue: item.status === "in_use" && Boolean(item.dueAt) && item.dueAt < now,
});

/** What students see: whether a free item is held, and whether the hold is theirs, never who holds it */
export const listEquipmentForStudent = async (userId, now = new Date()) => {
  const items = await prisma.equipment.findMany({ include: equipmentInclude, orderBy: { name: "asc" } });
  return items.map((item) => {
    const hold = liveHold(item, now);
    return { ...baseView(item, now), reservation: hold ? { mine: hold.userId === userId, until: hold.until } : null };
  });
};

/** What staff see: who holds what */
export const listEquipmentForStaff = async (now = new Date()) => {
  const items = await prisma.equipment.findMany({ include: equipmentInclude, orderBy: { name: "asc" } });
  return items.map((item) => {
    const hold = liveHold(item, now);
    return {
      ...baseView(item, now),
      reservation: hold
        ? { until: hold.until, userId: hold.userId, name: hold.user?.fullname ?? null, rollNo: hold.user?.roll_no ?? null }
        : null,
    };
  });
};

// ---------------------------------------------------------------- staff actions

/** Lend a free item to a roll number for `durationMinutes`. Staff may override a borrowing block. */
export const lendEquipment = async ({ equipmentId, rollNo, durationMinutes, adminId, overrideBlock = false }) => {
  const now = new Date();
  const standing = await getStanding(rollNo, now);
  if (standing.blocked && !overrideBlock) throw blockedError(standing);

  const result = await prisma.$transaction(async (tx) => {
    const item = await lockEquipment(tx, equipmentId);
    if (item.status === "in_use") throw new ApiError(409, `The ${item.name} is already out.`);
    if (item.status === "broken") {
      throw new ApiError(409, `The ${item.name} is marked broken. Mark it free first if it's been fixed.`);
    }

    const user = await findUserByRoll(tx, rollNo);
    const hold = liveHold(item, now);
    if (hold && hold.userId !== user?.id) {
      throw new ApiError(
        409,
        `The ${item.name} is held for ${hold.user?.fullname} (${hold.user?.roll_no}) until ${formatClock(hold.until)}. ` +
          "Release the hold first to lend it to someone else.",
        [{ code: "HELD_FOR_SOMEONE_ELSE" }]
      );
    }

    const dueAt = new Date(now.getTime() + durationMinutes * MINUTE);
    const loan = await tx.loan.create({
      data: {
        equipmentId,
        userId: user?.id ?? null,
        roll_no: rollNo,
        issuedAt: now,
        dueAt,
        fromReservation: Boolean(hold),
        issuedById: adminId,
      },
    });
    const equipment = await tx.equipment.update({
      where: { id: equipmentId },
      data: {
        status: "in_use",
        userId: user?.id ?? null,
        roll_no: rollNo,
        issuedAt: now,
        dueAt,
        reservedById: null,
        reservedUntil: null,
        reservationRemindedAt: null,
      },
    });
    await tx.equipmentHistory.create({
      data: {
        equipmentId,
        status: "in_use",
        roll_no: rollNo,
        dueAt,
        userId: user?.id ?? null,
        changedById: adminId,
        changedAt: now,
        expireAt: historyExpiry(now),
      },
    });
    return { loan, equipment, student: user, overrodeBlock: standing.blocked };
  });

  publish("equipment.changed", { equipmentId }, { everyone: true });
  return result;
};

/** Take an item back. Reports whether it came back late (after the grace period). */
export const returnEquipment = async ({ equipmentId, adminId }) => {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const item = await lockEquipment(tx, equipmentId);
    if (item.status !== "in_use") throw new ApiError(409, `The ${item.name} isn't out.`);

    const loan = await tx.loan.findFirst({ where: { equipmentId, returnedAt: null }, orderBy: { issuedAt: "desc" } });
    if (loan) await tx.loan.update({ where: { id: loan.id }, data: { returnedAt: now, returnedToId: adminId } });

    const equipment = await tx.equipment.update({
      where: { id: equipmentId },
      data: { status: "available", userId: null, roll_no: null, issuedAt: null, dueAt: null },
    });
    await tx.equipmentHistory.create({
      data: { equipmentId, status: "available", changedById: adminId, changedAt: now, expireAt: historyExpiry(now) },
    });
    const late = Boolean(loan) && now.getTime() > loan.dueAt.getTime() + LATE_GRACE_MINUTES * MINUTE;
    return { equipment, late, rollNo: loan?.roll_no ?? item.roll_no };
  });

  publish("equipment.changed", { equipmentId }, { everyone: true });
  return result;
};

/** Mark an item free or broken. An item that was out is treated as returned; a hold is cancelled. */
export const setEquipmentStatus = async ({ equipmentId, status, adminId }) => {
  const now = new Date();
  const { equipment, cancelledHold, itemName } = await prisma.$transaction(async (tx) => {
    const item = await lockEquipment(tx, equipmentId);
    if (item.status === status) {
      throw new ApiError(409, `The ${item.name} is already ${status === "broken" ? "marked broken" : "free"}.`);
    }

    if (item.status === "in_use") {
      await tx.loan.updateMany({
        where: { equipmentId, returnedAt: null },
        data: { returnedAt: now, returnedToId: adminId },
      });
    }
    const hold = status === "broken" ? liveHold(item, now) : null;

    const updated = await tx.equipment.update({
      where: { id: equipmentId },
      data: {
        status,
        userId: null,
        roll_no: null,
        issuedAt: null,
        dueAt: null,
        ...(status === "broken" && { reservedById: null, reservedUntil: null, reservationRemindedAt: null }),
      },
    });
    await tx.equipmentHistory.create({
      data: { equipmentId, status, changedById: adminId, changedAt: now, expireAt: historyExpiry(now) },
    });
    return { equipment: updated, cancelledHold: hold, itemName: item.name };
  });

  if (cancelledHold) {
    await notify(cancelledHold.userId, {
      type: "reservation_expired",
      title: `Your hold on the ${itemName} was cancelled`,
      body: "The desk marked it broken. Reserve something else from your dashboard.",
      link: "/student/dashboard",
    });
  }
  publish("equipment.changed", { equipmentId }, { everyone: true });
  return equipment;
};

/** Staff release a student's hold, e.g. when they say they no longer need it */
export const releaseReservation = async ({ equipmentId }) => {
  const now = new Date();
  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item) throw new ApiError(404, "That item doesn't exist.");
  const hold = liveHold(item, now);
  if (!hold) throw new ApiError(409, `Nobody is holding the ${item.name}.`);

  await prisma.equipment.update({
    where: { id: equipmentId },
    data: { reservedById: null, reservedUntil: null, reservationRemindedAt: null },
  });
  await notify(hold.userId, {
    type: "reservation_expired",
    title: `The desk released your hold on the ${item.name}`,
    body: "You can reserve it again from your dashboard if it's still free.",
    link: "/student/dashboard",
  });
  publish("equipment.changed", { equipmentId }, { everyone: true });
};

// ---------------------------------------------------------------- student actions

/** Hold a free item for RESERVATION_MINUTES so the student can walk to the desk. One hold at a time. */
export const reserveEquipment = async ({ equipmentId, user }) => {
  const now = new Date();
  const standing = await getStanding(normalizeRollNo(user.roll_no), now);
  if (standing.blocked) throw blockedError(standing);

  const existing = await prisma.equipment.findFirst({
    where: { reservedById: user.id, reservedUntil: { gt: now }, status: "available" },
    select: { name: true },
  });
  if (existing) {
    throw new ApiError(409, `You're already holding the ${existing.name}. Collect it or cancel that first.`);
  }

  const reservedUntil = new Date(now.getTime() + RESERVATION_MINUTES * MINUTE);
  // Conditional update so two students tapping at once can't both get the item
  const { count } = await prisma.equipment.updateMany({
    where: { id: equipmentId, status: "available", OR: [{ reservedUntil: null }, { reservedUntil: { lte: now } }] },
    data: { reservedById: user.id, reservedUntil, reservationRemindedAt: null },
  });
  if (count === 0) {
    const item = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true } });
    if (!item) throw new ApiError(404, "That item doesn't exist.");
    throw new ApiError(409, "Someone else just borrowed or reserved this item.");
  }

  publish("equipment.changed", { equipmentId }, { everyone: true });
  return { equipmentId, reservedUntil };
};

export const cancelReservation = async ({ equipmentId, userId }) => {
  const { count } = await prisma.equipment.updateMany({
    where: { id: equipmentId, reservedById: userId },
    data: { reservedById: null, reservedUntil: null, reservationRemindedAt: null },
  });
  if (count === 0) throw new ApiError(404, "You don't have a reservation on this item.");
  publish("equipment.changed", { equipmentId }, { everyone: true });
};

// ---------------------------------------------------------------- lookups

/** Everything the desk needs about a roll number before lending */
export const getStudentSummary = async (rollNo, now = new Date()) => {
  const [user, standing, activeLoans, recentLoans] = await Promise.all([
    prisma.user.findFirst({
      where: { roll_no: { equals: rollNo, mode: "insensitive" } },
      select: { id: true, fullname: true, email: true, phone_number: true, roll_no: true },
    }),
    getStanding(rollNo, now),
    prisma.loan.findMany({
      where: { roll_no: rollNo, returnedAt: null },
      orderBy: { dueAt: "asc" },
      select: { id: true, issuedAt: true, dueAt: true, equipment: { select: { id: true, name: true } } },
    }),
    prisma.loan.findMany({
      where: { roll_no: rollNo, returnedAt: { not: null } },
      orderBy: { issuedAt: "desc" },
      take: 5,
      select: { id: true, issuedAt: true, dueAt: true, returnedAt: true, equipment: { select: { id: true, name: true } } },
    }),
  ]);

  const hold = user
    ? await prisma.equipment.findFirst({
        where: { reservedById: user.id, reservedUntil: { gt: now }, status: "available" },
        select: { id: true, name: true, reservedUntil: true },
      })
    : null;

  return {
    rollNo,
    student: user,
    standing,
    activeLoans: activeLoans.map((l) => ({ ...l, overdue: l.dueAt < now })),
    recentLoans: recentLoans.map((l) => ({
      ...l,
      late: l.returnedAt.getTime() > l.dueAt.getTime() + LATE_GRACE_MINUTES * MINUTE,
    })),
    reservation: hold ? { equipmentId: hold.id, equipmentName: hold.name, until: hold.reservedUntil } : null,
  };
};

/** Loans that are past due, oldest first, for the desk dashboard */
export const listOverdueLoans = async (now = new Date()) => {
  const loans = await prisma.loan.findMany({
    where: { returnedAt: null, dueAt: { lt: now } },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      roll_no: true,
      issuedAt: true,
      dueAt: true,
      equipment: { select: { id: true, name: true } },
      user: { select: { id: true, fullname: true, phone_number: true } },
    },
  });
  return loans.map((l) => ({
    loanId: l.id,
    equipmentId: l.equipment.id,
    equipmentName: l.equipment.name,
    rollNo: l.roll_no,
    name: l.user?.fullname ?? null,
    phone: l.user?.phone_number ?? null,
    issuedAt: l.issuedAt,
    dueAt: l.dueAt,
    minutesOverdue: Math.floor((now.getTime() - l.dueAt.getTime()) / MINUTE),
  }));
};
