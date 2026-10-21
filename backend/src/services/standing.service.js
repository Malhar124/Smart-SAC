import { prisma } from "../db/index.js";
import {
  BLOCK_DAYS,
  DAY,
  LATE_GRACE_MINUTES,
  LATE_RETURN_LIMIT,
  LATE_RETURN_WINDOW_DAYS,
  MINUTE,
} from "../config/policy.js";
import { formatClock, formatDayClock } from "../lib/time.js";

const lateAfter = (loan) => loan.dueAt.getTime() + LATE_GRACE_MINUTES * MINUTE;

/**
 * A student's borrowing record, by roll number (loans are kept by roll number because the desk can
 * lend to students who haven't signed up). Borrowing is blocked while an item is overdue, and for
 * BLOCK_DAYS after the LATE_RETURN_LIMIT-th late return inside the window.
 */
export const getStanding = async (rollNo, now = new Date()) => {
  const windowStart = new Date(now.getTime() - LATE_RETURN_WINDOW_DAYS * DAY);
  const loans = await prisma.loan.findMany({
    where: { roll_no: rollNo, OR: [{ returnedAt: null }, { returnedAt: { gte: windowStart } }] },
    select: {
      id: true,
      issuedAt: true,
      dueAt: true,
      returnedAt: true,
      equipment: { select: { id: true, name: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  const overdue = loans.filter((l) => !l.returnedAt && l.dueAt.getTime() < now.getTime());
  const returnedLate = loans.filter((l) => l.returnedAt && l.returnedAt.getTime() > lateAfter(l));
  const stillOutPastGrace = loans.filter((l) => !l.returnedAt && now.getTime() > lateAfter(l));

  let blocked = false;
  let reason = null;
  let blockedUntil = null;
  let message = null;

  if (overdue.length > 0) {
    blocked = true;
    reason = "overdue";
    const first = overdue[0];
    message = `Return the ${first.equipment.name} first. It was due at ${formatClock(first.dueAt)}.`;
  } else if (returnedLate.length >= LATE_RETURN_LIMIT) {
    const latest = Math.max(...returnedLate.map((l) => l.returnedAt.getTime()));
    const until = new Date(latest + BLOCK_DAYS * DAY);
    if (until.getTime() > now.getTime()) {
      blocked = true;
      reason = "late_returns";
      blockedUntil = until;
      message = `Borrowing is paused until ${formatDayClock(until)} after ${returnedLate.length} late returns in ${LATE_RETURN_WINDOW_DAYS} days.`;
    }
  }

  return {
    rollNo,
    lateReturns: returnedLate.length + stillOutPastGrace.length,
    windowDays: LATE_RETURN_WINDOW_DAYS,
    limit: LATE_RETURN_LIMIT,
    graceMinutes: LATE_GRACE_MINUTES,
    blocked,
    reason,
    blockedUntil,
    message,
    overdue: overdue.map((l) => ({ loanId: l.id, equipmentId: l.equipment.id, equipmentName: l.equipment.name, dueAt: l.dueAt })),
  };
};
