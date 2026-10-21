import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { prisma } from "../db/index.js";
import { env } from "../config/env.js";
import { publish } from "../lib/events.js";
import { ADMIN_PUBLIC_FIELDS } from "../middlewares/auth.middleware.js";
import {
  cookieOptions,
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
  isPasswordCorrect,
  ROLES,
  verifyRefreshToken,
} from "../utils/auth.js";
import { listEquipmentForStaff, listOverdueLoans } from "../services/equipment.service.js";
import { notifyAllStudents } from "../services/notifications.service.js";
import { DAY } from "../config/policy.js";

const ok = (res, data, message, status = 200) => res.status(status).json(new ApiResponse(status, data, message));

const issueTokens = async (adminId) => {
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  const accessToken = generateAccessToken(admin, ROLES.ADMIN);
  const refreshToken = generateRefreshToken(admin, ROLES.ADMIN);
  await prisma.admin.update({ where: { id: adminId }, data: { refreshToken } });
  return { accessToken, refreshToken };
};

// Only emails listed in ADMIN_EMAILS (comma-separated) may register as staff
const isAllowedAdminEmail = (email) =>
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);

// ---------------------------------------------------------------- account

export const registerAdmin = async (req, res) => {
  const { email, password, name } = req.body;
  if (!isAllowedAdminEmail(email)) {
    throw new ApiError(403, "This email isn't on the staff list. Ask the SAC office to add it to ADMIN_EMAILS.");
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  // Staff created before per-admin passwords existed have no password yet; let them set one
  if (existing?.password) throw new ApiError(409, "A staff account with this email already exists.");

  const admin = await prisma.admin.upsert({
    where: { email },
    update: { password: await hashPassword(password), name },
    create: { email, name, password: await hashPassword(password) },
    select: ADMIN_PUBLIC_FIELDS,
  });
  return ok(res, admin, "Staff account created", 201);
};

export const loginAdmin = async (req, res) => {
  const { email, password } = req.body;
  const admin = await prisma.admin.findUnique({ where: { email } });
  // Same error for unknown email and wrong password so emails can't be enumerated
  if (!admin || !(await isPasswordCorrect(password, admin.password))) {
    throw new ApiError(401, "That email and password don't match.");
  }

  const { accessToken, refreshToken } = await issueTokens(admin.id);
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, { admin: { id: admin.id, email: admin.email, name: admin.name } }, "Signed in"));
};

export const logoutAdmin = async (req, res) => {
  await prisma.admin.update({ where: { id: req.user.id }, data: { refreshToken: null } });
  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "Signed out"));
};

export const refreshAccessToken = async (req, res) => {
  const incoming = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!incoming) throw new ApiError(401, "Sign in again.");

  let decoded;
  try {
    decoded = verifyRefreshToken(incoming);
  } catch {
    throw new ApiError(401, "Your session expired. Sign in again.");
  }
  if (decoded.role !== ROLES.ADMIN) throw new ApiError(401, "Sign in again.");

  const admin = await prisma.admin.findUnique({ where: { id: decoded._id } });
  if (!admin || admin.refreshToken !== incoming) throw new ApiError(401, "Your session expired. Sign in again.");

  const { accessToken, refreshToken } = await issueTokens(admin.id);
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, {}, "Session refreshed"));
};

export const getCurrentAdmin = async (req, res) => ok(res, req.user, "Current staff member");

export const updateAccountDetails = async (req, res) => {
  const admin = await prisma.admin.update({ where: { id: req.user.id }, data: req.body, select: ADMIN_PUBLIC_FIELDS });
  return ok(res, admin, "Account saved");
};

// ---------------------------------------------------------------- dashboard

export const dashboardDetails = async (req, res) => {
  const now = new Date();
  const [equipment, overdue, announcements, openTickets] = await Promise.all([
    listEquipmentForStaff(now),
    listOverdueLoans(now),
    prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.ticket.count({ where: { status: { in: ["open", "in_process"] } } }),
  ]);

  const counts = {
    out: equipment.filter((e) => e.status === "in_use").length,
    free: equipment.filter((e) => e.status === "available" && !e.reservation).length,
    reserved: equipment.filter((e) => e.reservation).length,
    broken: equipment.filter((e) => e.status === "broken").length,
    overdue: overdue.length,
    openTickets,
    total: equipment.length,
  };
  return ok(res, { counts, overdue, announcements }, "Dashboard");
};

// ---------------------------------------------------------------- games and equipment

export const getGames = async (req, res) => {
  const games = await prisma.game.findMany({
    orderBy: { name: "asc" },
    include: { equipments: { orderBy: { name: "asc" }, select: { id: true, name: true, status: true } } },
  });
  return ok(res, games, "Games");
};

export const addGame = async (req, res) => {
  const existing = await prisma.game.findUnique({ where: { name: req.body.name } });
  if (existing) throw new ApiError(409, "A game with this name already exists.", [{ path: "name", message: "Already exists." }]);
  const game = await prisma.game.create({ data: { name: req.body.name } });
  publish("equipment.changed", {}, { everyone: true });
  return ok(res, game, "Game added", 201);
};

export const removeGame = async (req, res) => {
  const game = await prisma.game.findUnique({
    where: { id: req.body.gameId },
    include: { equipments: { select: { id: true, name: true, status: true } } },
  });
  if (!game) throw new ApiError(404, "That game doesn't exist.");
  const out = game.equipments.filter((e) => e.status === "in_use");
  if (out.length > 0) {
    throw new ApiError(409, `Take back the ${out.map((e) => e.name).join(", ")} before removing ${game.name}.`);
  }

  await prisma.$transaction([
    prisma.equipment.deleteMany({ where: { id: { in: game.equipments.map((e) => e.id) } } }),
    prisma.game.delete({ where: { id: game.id } }),
  ]);
  publish("equipment.changed", {}, { everyone: true });
  return ok(res, { gameId: game.id }, "Game removed");
};

export const addEquipment = async (req, res) => {
  const { gameId, name } = req.body;
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) throw new ApiError(404, "That game doesn't exist.");
  const taken = await prisma.equipment.findUnique({ where: { name }, select: { id: true } });
  if (taken) {
    throw new ApiError(409, "An item with this name already exists. Number them, like “badminton racket 3”.", [
      { path: "name", message: "Already exists." },
    ]);
  }

  const item = await prisma.equipment.create({ data: { name, games: { connect: { id: gameId } } } });
  publish("equipment.changed", { equipmentId: item.id }, { everyone: true });
  return ok(res, item, "Equipment added", 201);
};

export const removeEquipment = async (req, res) => {
  const item = await prisma.equipment.findUnique({ where: { id: req.body.equipmentId } });
  if (!item) throw new ApiError(404, "That item doesn't exist.");
  if (item.status === "in_use") throw new ApiError(409, `The ${item.name} is out. Mark it returned before removing it.`);

  await prisma.equipment.delete({ where: { id: item.id } });
  publish("equipment.changed", { equipmentId: item.id }, { everyone: true });
  return ok(res, { equipmentId: item.id }, "Equipment removed");
};

// ---------------------------------------------------------------- announcements

export const makeAnnouncement = async (req, res) => {
  const { heading, content, footer, expiresInDays } = req.body;
  const announcement = await prisma.announcement.create({
    data: {
      heading,
      content,
      footer: footer ?? "",
      expireAt: new Date(Date.now() + expiresInDays * DAY),
      createdById: req.user.id,
    },
  });

  await notifyAllStudents({ type: "announcement", title: heading, body: content.slice(0, 160), link: "/announcements" });
  publish("announcement.changed", { announcementId: announcement.id }, { everyone: true });
  return ok(res, announcement, "Announcement posted", 201);
};

export const getAnnouncements = async (req, res) => {
  const pageSize = 10;
  const { page } = req.query;
  const [total, announcements] = await Promise.all([
    prisma.announcement.count(),
    prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { createdBy: { select: { name: true, email: true } } },
    }),
  ]);
  return ok(res, { announcements, page, totalPages: Math.max(1, Math.ceil(total / pageSize)), total }, "Announcements");
};

export const deleteAnnouncement = async (req, res) => {
  const { id } = req.params;
  const exists = await prisma.announcement.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new ApiError(404, "That announcement doesn't exist.");
  await prisma.announcement.delete({ where: { id } });
  publish("announcement.changed", { announcementId: id }, { everyone: true });
  return ok(res, { id }, "Announcement removed");
};

// ---------------------------------------------------------------- history

const historyInclude = {
  user: { select: { fullname: true, roll_no: true } },
  changedBy: { select: { name: true, email: true } },
};

const toHistoryView = (h) => ({
  id: h.id,
  status: h.status,
  rollNo: h.roll_no,
  dueAt: h.dueAt,
  changedAt: h.changedAt,
  student: h.user ? { name: h.user.fullname, rollNo: h.user.roll_no } : null,
  staff: h.changedBy ? h.changedBy.name || h.changedBy.email : null,
  ...(h.equipment ? { equipment: h.equipment } : {}),
});

export const getRecentEquipmentHistory = async (req, res) => {
  const history = await prisma.equipmentHistory.findMany({
    orderBy: { changedAt: "desc" },
    take: 10,
    include: { ...historyInclude, equipment: { select: { id: true, name: true } } },
  });
  return ok(res, history.map(toHistoryView), "Recent changes");
};

/** Every item with its three latest changes, for the History page */
export const getEquipmentHistoryOverview = async (req, res) => {
  const items = await prisma.equipment.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { history: true } },
      history: { orderBy: { changedAt: "desc" }, take: 3, include: historyInclude },
    },
  });
  return ok(
    res,
    items.map((i) => ({ id: i.id, name: i.name, status: i.status, total: i._count.history, history: i.history.map(toHistoryView) })),
    "History"
  );
};

export const getEquipmentHistory = async (req, res) => {
  const { equipmentId } = req.params;
  const { page } = req.query;
  const pageSize = 20;
  const item = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true, name: true } });
  if (!item) throw new ApiError(404, "That item doesn't exist.");

  const [total, history] = await Promise.all([
    prisma.equipmentHistory.count({ where: { equipmentId } }),
    prisma.equipmentHistory.findMany({
      where: { equipmentId },
      orderBy: { changedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: historyInclude,
    }),
  ]);
  return ok(
    res,
    { equipment: item, history: history.map(toHistoryView), page, totalPages: Math.max(1, Math.ceil(total / pageSize)), total },
    "History"
  );
};

// ---------------------------------------------------------------- search (command palette)

export const search = async (req, res) => {
  const { q } = req.query;
  const contains = { contains: q, mode: "insensitive" };
  const [equipment, students, rooms, tickets] = await Promise.all([
    prisma.equipment.findMany({ where: { name: contains }, take: 6, orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.user.findMany({
      where: { OR: [{ fullname: contains }, { roll_no: contains }, { email: contains }] },
      take: 6,
      orderBy: { fullname: "asc" },
      select: { id: true, fullname: true, roll_no: true, email: true },
    }),
    prisma.room.findMany({ where: { name: contains }, take: 4, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.ticket.findMany({
      where: { heading: contains },
      take: 4,
      orderBy: { updatedAt: "desc" },
      select: { id: true, heading: true, status: true },
    }),
  ]);
  return ok(res, { equipment, students, rooms, tickets }, "Search results");
};
