import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { prisma } from "../db/index.js";
import { publish } from "../lib/events.js";
import { deliverCode } from "../utils/mail.js";
import { USER_PUBLIC_FIELDS } from "../middlewares/auth.middleware.js";
import {
  cookieOptions,
  generateAccessToken,
  generateOtp,
  generateRefreshToken,
  hashPassword,
  isPasswordCorrect,
  normalizeRollNo,
  verifyRefreshToken,
} from "../utils/auth.js";
import { getStanding } from "../services/standing.service.js";
import { listEquipmentForStudent } from "../services/equipment.service.js";
import { countOpenTicketsForUser } from "../services/tickets.service.js";
import { listUpcomingBookingsForUser } from "../services/rooms.service.js";
import { DAY, MINUTE } from "../config/policy.js";

const VERIFICATION_TTL = DAY;
const RESET_TTL = 10 * MINUTE;

const issueTokens = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await prisma.user.update({ where: { id: userId }, data: { refreshToken } });
  return { accessToken, refreshToken };
};

const publicUser = (id) => prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_FIELDS });

/** Messages the receiver hasn't opened yet */
const unreadMessageWhere = (userId) => ({ receiverId: userId, status: { in: ["sent", "received"] } });

// ---------------------------------------------------------------- account

export const registerUser = async (req, res) => {
  const { fullname, email, username, roll_no, password, phone_number } = req.body;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }, { phone_number }] },
    select: { username: true, email: true, phone_number: true },
  });
  if (existing) {
    const field = existing.email === email ? "email" : existing.username === username ? "username" : "phone number";
    throw new ApiError(409, `An account with that ${field} already exists.`, [{ path: field === "phone number" ? "phone_number" : field, message: `That ${field} is already registered.` }]);
  }

  const code = generateOtp();
  const user = await prisma.user.create({
    data: {
      fullname,
      email,
      username,
      roll_no: normalizeRollNo(roll_no),
      phone_number,
      password: await hashPassword(password),
      emailVerificationToken: code,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL),
      isVerified: false,
    },
    select: USER_PUBLIC_FIELDS,
  });

  let delivered;
  try {
    delivered = await deliverCode({ purpose: "verification", to: user.email, name: user.fullname, code, expiresIn: "24 hours" });
  } catch (error) {
    // In production an account nobody can verify is useless; undo it so the person can retry
    await prisma.user.delete({ where: { id: user.id } });
    throw new ApiError(502, "We couldn't send the verification email. Try again in a few minutes.");
  }

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { user, emailDelivered: delivered },
        delivered
          ? "Account created. Check your email for the verification code."
          : "Account created. Email isn't set up on this server, so the code is in the backend log."
      )
    );
};

export const verifyEmail = async (req, res) => {
  const { email, token } = req.body;
  const user = await prisma.user.findFirst({
    where: { email, emailVerificationToken: token, emailVerificationExpires: { gt: new Date() } },
    select: { id: true },
  });
  if (!user) throw new ApiError(400, "That code is wrong or has expired. Ask for a new one.");

  await prisma.user.update({
    where: { id: user.id },
    data: { isVerified: true, emailVerificationToken: null, emailVerificationExpires: null },
  });
  return res.status(200).json(new ApiResponse(200, await publicUser(user.id), "Email confirmed. You can sign in now."));
};

export const resendVerificationEmail = async (req, res) => {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  // Same answer whether or not the account exists, so emails can't be probed
  const generic = new ApiResponse(200, {}, "If that account exists and isn't confirmed yet, a new code is on its way.");
  if (!user || user.isVerified) return res.status(200).json(generic);

  const code = generateOtp();
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationToken: code, emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL) },
  });
  await deliverCode({ purpose: "verification", to: user.email, name: user.fullname, code, expiresIn: "24 hours" });
  return res.status(200).json(generic);
};

export const loginUser = async (req, res) => {
  const { email: identifier, password } = req.body;
  const user = await prisma.user.findFirst({ where: { OR: [{ username: identifier }, { email: identifier }] } });

  // One message for unknown account and wrong password so accounts can't be probed
  if (!user || !(await isPasswordCorrect(password, user.password))) {
    throw new ApiError(401, "That email or username and password don't match.");
  }
  if (!user.isVerified) {
    throw new ApiError(403, "Confirm your email before signing in. We can send a new code.", [
      { code: "EMAIL_NOT_VERIFIED", email: user.email },
    ]);
  }

  const { accessToken, refreshToken } = await issueTokens(user.id);
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, { user: await publicUser(user.id) }, "Signed in"));
};

export const logoutUser = async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { refreshToken: null } });
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
  if (decoded.role !== "user") throw new ApiError(401, "Sign in again.");

  const user = await prisma.user.findUnique({ where: { id: decoded._id } });
  // A token that no longer matches the stored one was rotated or revoked
  if (!user || user.refreshToken !== incoming) throw new ApiError(401, "Your session expired. Sign in again.");

  const { accessToken, refreshToken } = await issueTokens(user.id);
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, {}, "Session refreshed"));
};

export const changeCurrentPassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await isPasswordCorrect(oldPassword, user.password))) {
    throw new ApiError(400, "Your current password is wrong.", [{ path: "oldPassword", message: "Your current password is wrong." }]);
  }
  if (oldPassword === newPassword) {
    throw new ApiError(400, "Choose a password you haven't been using.", [{ path: "newPassword", message: "Choose a different password." }]);
  }

  await prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(newPassword) } });
  return res.status(200).json(new ApiResponse(200, {}, "Password changed"));
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  const generic = new ApiResponse(200, {}, "If that account exists, a reset code is on its way.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(200).json(generic);

  const code = generateOtp();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: code, passwordResetExpires: new Date(Date.now() + RESET_TTL) },
  });
  await deliverCode({ purpose: "password reset", to: user.email, name: user.fullname, code, expiresIn: "10 minutes" });
  return res.status(200).json(generic);
};

const findResetUser = (email, token) =>
  prisma.user.findFirst({
    where: { email, passwordResetToken: token, passwordResetExpires: { gt: new Date() } },
    select: { id: true },
  });

export const verifyResetToken = async (req, res) => {
  const user = await findResetUser(req.body.email, req.body.token);
  if (!user) throw new ApiError(400, "That code is wrong or has expired. Ask for a new one.");
  return res.status(200).json(new ApiResponse(200, { verified: true }, "Code accepted"));
};

export const resetPassword = async (req, res) => {
  const { email, token, newPassword } = req.body;
  const user = await findResetUser(email, token);
  if (!user) throw new ApiError(400, "That code is wrong or has expired. Ask for a new one.");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await hashPassword(newPassword),
      passwordResetToken: null,
      passwordResetExpires: null,
      // Signs out every other session
      refreshToken: null,
    },
  });
  return res.status(200).json(new ApiResponse(200, {}, "Password reset. Sign in with your new password."));
};

/** The signed-in student, plus what they have out and their borrowing standing */
export const getCurrentUser = async (req, res) => {
  const now = new Date();
  const userDetails = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { ...USER_PUBLIC_FIELDS, games: { include: { game: true } } },
  });
  const rollNo = normalizeRollNo(userDetails.roll_no);

  const [loans, standing, reservation, roomBookings] = await Promise.all([
    prisma.loan.findMany({
      where: { roll_no: rollNo, returnedAt: null },
      orderBy: { dueAt: "asc" },
      select: { id: true, issuedAt: true, dueAt: true, equipment: { select: { id: true, name: true } } },
    }),
    getStanding(rollNo, now),
    prisma.equipment.findFirst({
      where: { reservedById: req.user.id, reservedUntil: { gt: now }, status: "available" },
      select: { id: true, name: true, reservedUntil: true },
    }),
    listUpcomingBookingsForUser(req.user.id, now),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        userDetails,
        loans: loans.map((l) => ({ ...l, overdue: l.dueAt < now })),
        standing,
        reservation,
        roomBookings,
      },
      "Current user"
    )
  );
};

export const updateAccountDetails = async (req, res) => {
  const { games, ...fields } = req.body;
  const userId = req.user.id;

  if (fields.phone_number) {
    const taken = await prisma.user.findFirst({
      where: { phone_number: fields.phone_number, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw new ApiError(409, "That phone number is already registered.", [{ path: "phone_number", message: "Already registered to another account." }]);
  }
  if (fields.roll_no) fields.roll_no = normalizeRollNo(fields.roll_no);

  if (games) {
    const known = await prisma.game.count({ where: { id: { in: games.map((g) => g.game) } } });
    if (known !== new Set(games.map((g) => g.game)).size) throw new ApiError(400, "One of those games doesn't exist any more.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(fields).length > 0) await tx.user.update({ where: { id: userId }, data: fields });
    if (games) {
      await tx.userGameRating.deleteMany({ where: { userId } });
      await tx.userGameRating.createMany({ data: games.map((g) => ({ userId, gameId: g.game, rating: g.rating })) });
    }
    return tx.user.findUnique({ where: { id: userId }, select: { ...USER_PUBLIC_FIELDS, games: { include: { game: true } } } });
  });

  return res.status(200).json(new ApiResponse(200, updated, "Profile saved"));
};

// ---------------------------------------------------------------- dashboard

export const dashboardDetails = async (req, res) => {
  const userId = req.user.id;
  const now = new Date();
  const [unreadMessages, openTickets, unreadNotifications, equipment, announcements, standing] = await Promise.all([
    prisma.message.count({ where: unreadMessageWhere(userId) }),
    countOpenTicketsForUser(userId),
    prisma.notification.count({ where: { userId, readAt: null } }),
    listEquipmentForStudent(userId, now),
    prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 2 }),
    getStanding(normalizeRollNo(req.user.roll_no), now),
  ]);

  return res
    .status(200)
    .json(new ApiResponse(200, { unreadMessages, openTickets, unreadNotifications, equipment, announcements, standing }, "Dashboard"));
};

// ---------------------------------------------------------------- players and chat

export const getAllPlayers = async (req, res) => {
  const players = await prisma.user.findMany({
    where: { id: { not: req.user.id }, isVerified: true },
    orderBy: { fullname: "asc" },
    select: { id: true, fullname: true, games: { include: { game: { select: { id: true, name: true } } } } },
  });
  return res.status(200).json(new ApiResponse(200, players, "Players"));
};

export const getGames = async (req, res) => {
  const games = await prisma.game.findMany({ orderBy: { name: "asc" } });
  return res.status(200).json(new ApiResponse(200, games, "Games"));
};

export const sendMessage = async (req, res) => {
  const { receiverId, content } = req.body;
  const senderId = req.user.id;
  if (receiverId === senderId) throw new ApiError(400, "You can't message yourself.");

  const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } });
  if (!receiver) throw new ApiError(404, "That student doesn't exist.");

  const message = await prisma.message.create({ data: { senderId, receiverId, content, status: "sent" } });
  publish("message.new", { messageId: message.id, senderId, receiverId }, { users: [senderId, receiverId] });

  return res.status(201).json(
    new ApiResponse(201, { id: message.id, sender: senderId, content: message.content, createdAt: message.createdAt, status: message.status }, "Sent")
  );
};

export const getConversations = async (req, res) => {
  const userId = req.user.id;
  // Latest message per conversation partner, with how many of theirs this student hasn't read
  const rows = await prisma.$queryRaw`
    WITH ranked AS (
      SELECT
        m.*,
        CASE WHEN m."senderId" = ${userId} THEN m."receiverId" ELSE m."senderId" END AS "otherUserId",
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN m."senderId" = ${userId} THEN m."receiverId" ELSE m."senderId" END
          ORDER BY m."createdAt" DESC
        ) AS rn
      FROM "Message" m
      WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
    )
    SELECT
      r."otherUserId", r.content, r.status, r."senderId", r."createdAt",
      u.fullname AS "otherFullname",
      (SELECT count(*) FROM "Message" m2
        WHERE m2."receiverId" = ${userId} AND m2."senderId" = r."otherUserId"
          AND m2.status IN ('sent', 'received')) AS "unreadCount",
      (SELECT g.name FROM "UserGameRating" ugr JOIN "Game" g ON g.id = ugr."gameId"
        WHERE ugr."userId" = r."otherUserId" ORDER BY ugr.rating DESC, g.name ASC LIMIT 1) AS "topGame"
    FROM ranked r
    JOIN "User" u ON u.id = r."otherUserId"
    WHERE r.rn = 1
    ORDER BY r."createdAt" DESC
  `;

  const conversations = rows.map((r) => ({
    otherUser: { id: r.otherUserId, fullname: r.otherFullname, sport: r.topGame ?? null },
    lastMessage: r.content,
    lastMessageStatus: r.status,
    lastMessageSender: r.senderId,
    lastMessageCreatedAt: r.createdAt,
    unreadCount: Number(r.unreadCount),
  }));
  return res.status(200).json(new ApiResponse(200, conversations, "Conversations"));
};

export const getMessages = async (req, res) => {
  const { otherUserId } = req.params;
  const userId = req.user.id;

  const { count } = await prisma.message.updateMany({
    where: { receiverId: userId, senderId: otherUserId, status: { in: ["sent", "received"] } },
    data: { status: "read" },
  });
  // Let the sender's tabs know their messages were read, and this student's other tabs update badges
  if (count > 0) publish("message.read", { readerId: userId, otherUserId }, { users: [userId, otherUserId] });

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, senderId: true, content: true, createdAt: true, status: true },
  });

  return res.status(200).json(
    new ApiResponse(200, messages.map((m) => ({ id: m.id, sender: m.senderId, content: m.content, createdAt: m.createdAt, status: m.status })), "Messages")
  );
};

// ---------------------------------------------------------------- announcements (public)

export const getPublicAnnouncements = async (req, res) => {
  const pageSize = 10;
  const { page } = req.query;
  const [total, announcements] = await Promise.all([
    prisma.announcement.count(),
    prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, heading: true, content: true, footer: true, createdAt: true },
    }),
  ]);
  return res
    .status(200)
    .json(new ApiResponse(200, { announcements, page, totalPages: Math.max(1, Math.ceil(total / pageSize)), total }, "Announcements"));
};
