import { prisma } from "../db/index.js";
import { ApiError } from "../utils/ApiError.js";
import { startOfLocalHour, zonedParts } from "../lib/time.js";
import { DAY, HOUR, MINUTE, SAC_CLOSE_HOUR, SAC_OPEN_HOUR } from "../config/policy.js";

/** Below this many checkouts in the window, the chart would mislead; the page says so instead */
export const MIN_LOANS_FOR_CHART = 10;

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * How busy the desk is at each hour of a typical day, from real checkouts over the last `days` days:
 * for every loan, each local clock hour it overlapped counts once; dividing by the number of days
 * gives the average number of items out during that hour. Optionally limited to one game's equipment.
 */
export const getUsage = async ({ days, gameId }) => {
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);

  let equipmentIds = null;
  if (gameId) {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { equipments: { select: { id: true } } },
    });
    if (!game) throw new ApiError(404, "That game doesn't exist.");
    equipmentIds = game.equipments.map((e) => e.id);
  }

  const [loans, games] = await Promise.all([
    prisma.loan.findMany({
      where: {
        issuedAt: { lt: to },
        OR: [{ returnedAt: null }, { returnedAt: { gt: from } }],
        ...(equipmentIds && { equipmentId: { in: equipmentIds } }),
      },
      select: { issuedAt: true, returnedAt: true },
    }),
    prisma.game.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const loanHours = new Array(24).fill(0);
  for (const loan of loans) {
    const start = Math.max(loan.issuedAt.getTime(), from.getTime());
    const end = Math.min((loan.returnedAt ?? to).getTime(), to.getTime());
    // Walk the local clock hours the loan touched, starting from the hour it began in
    for (let t = startOfLocalHour(new Date(start)).getTime(); t < end; t += HOUR) {
      loanHours[zonedParts(new Date(t)).hour] += 1;
    }
  }

  const hours = [];
  for (let hour = SAC_OPEN_HOUR; hour < SAC_CLOSE_HOUR; hour += 1) {
    hours.push({ hour, averageOut: Math.round((loanHours[hour] / days) * 10) / 10 });
  }

  const started = loans.filter((l) => l.issuedAt >= from);
  const finished = started.filter((l) => l.returnedAt);
  const typical = median(finished.map((l) => (l.returnedAt.getTime() - l.issuedAt.getTime()) / MINUTE));
  const enoughData = started.length >= MIN_LOANS_FOR_CHART;
  const byBusy = [...hours].sort((a, b) => b.averageOut - a.averageOut);

  return {
    days,
    from,
    to,
    gameId: gameId ?? null,
    games,
    totalLoans: started.length,
    enoughData,
    minLoans: MIN_LOANS_FOR_CHART,
    hours,
    busiestHour: enoughData ? byBusy[0].hour : null,
    quietestHour: enoughData ? byBusy[byBusy.length - 1].hour : null,
    typicalLoanMinutes: typical === null ? null : Math.round(typical),
  };
};
