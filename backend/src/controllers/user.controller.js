import { timingSafeEqual } from "crypto";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { prisma } from "../db/index.js";
import { publish } from "../lib/events.js";
import { deliverCode } from "../utils/mail.js";
import { USER_PUBLIC_FIELDS } from "../middlewares/auth.middleware.js";
import { cookieOptions, generateOtp, hashPassword, isPasswordCorrect, normalizeRollNo, ROLES } from "../utils/auth.js";
import { endSession, endSessionsFor, rotateSession, startSession } from "../services/session.service.js";
import { getStanding } from "../services/standing.service.js";
import { listEquipmentForStudent } from "../services/equipment.service.js";
import { countOpenTicketsForUser } from "../services/tickets.service.js";
import { listUpcomingBookingsForUser } from "../services/rooms.service.js";
import { CODE_RESEND_SECONDS, DAY, MAX_CODE_ATTEMPTS, MINUTE } from "../config/policy.js";

const VERIFICATION_TTL = DAY;
const RESET_TTL = 10 * MINUTE;

const CODE_FIELDS = {
  verification: { token: "emailVerificationToken", expires: "emailVerificationExpires", attempts: "emailVerificationAttempts", ttl: VERIFICATION_TTL },
  reset: { token: "passwordResetToken", expires: "passwordResetExpires", attempts: "passwordResetAttempts", ttl: RESET_TTL },
};

const sameCode = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Check an emailed code. Each check uses up one of MAX_CODE_ATTEMPTS *before* comparing, so guesses
 * sent all at once from many addresses still get only that many tries at a 6-digit code; after that
 * the person asks for a new one. Returns the user's id when the code matches.
 */
const checkCode = async (kind, email, token) => {
  const f = CODE_FIELDS[kind];
  const { count } = await prisma.user.updateMany({
    where: { email, [f.token]: { not: null }, [f.expires]: { gt: new Date() }, [f.attempts]: { lt: MAX_CODE_ATTEMPTS } },
    data: { [f.attempts]: { increment: 1 } },
  });
  if (count === 0) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, [f.token]: true } });
  return user?.[f.token] && sameCode(user[f.token], token) ? user.id : null;
};

/** A fresh code for `user`, or null when one went out in the last CODE_RESEND_SECONDS (no email bombing) */
const issueCode = async (user, kind) => {
  const f = CODE_FIELDS[kind];
  const sentAt = user[f.expires] ? user[f.expires].getTime() - f.ttl : 0;
  if (Date.now() - sentAt < CODE_RESEND_SECONDS * 1000) return null;
  const code = generateOtp();
  await prisma.user.update({
    where: { id: user.id },
    data: { [f.token]: code, [f.expires]: new Date(Date.now() + f.ttl), [f.attempts]: 0 },
  });
  return code;
};

const publicUser = (id) => prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_FIELDS });

/** Messages the receiver hasn't opened yet */
const unreadMessageWhere = (userId) => ({ receiverId: userId, status: { in: ["sent", "received"] } });

// ---------------------------------------------------------------- account

export const registerUser = async (req, res) => {
  const { fullname, email, username, roll_no, password, phone_number } = req.body;
  const rollNo = normalizeRollNo(roll_no);

  // A sign-up that hasn't been confirmed holds nothing: a newer sign-up with the same email, username,
  // phone number or roll number replaces it, so nobody can block a classmate by signing up as them.
  const clashes = await prisma.user.findMany({
    where: { OR: [{ username }, { email }, { phone_number }, { roll_no: rollNo }] },
    select: { id: true, isVerified: true, username: true, email: true, phone_number: true },
  });
  const taken = clashes.find((u) => u.isVerified);
  if (taken) {
    const [path, label] =
      taken.email === email
        ? ["email", "email"]
        : taken.username === username
          ? ["username", "username"]
          : taken.phone_number === phone_number
            ? ["phone_number", "phone number"]
            : ["roll_no", "roll number"];
    throw new ApiError(409, `An account with that ${label} already exists.`, [{ path, message: `That ${label} is already registered.` }]);
  }

  const code = generateOtp();
  const hashedPassword = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { id: { in: clashes.map((u) => u.id) }, isVerified: false } });
    return tx.user.create({
      data: {
        fullname,
        email,
        username,
        roll_no: rollNo,
        phone_number,
        password: hashedPassword,
        emailVerificationToken: code,
        emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL),
        isVerified: false,
      },
      select: USER_PUBLIC_FIELDS,
    });
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
  const userId = await checkCode("verification", email, token);
  if (!userId) throw new ApiError(400, "That code is wrong or has expired. Ask for a new one.");

  await prisma.user.update({
    where: { id: userId },
    data: { isVerified: true, emailVerificationToken: null, emailVerificationExpires: null, emailVerificationAttempts: 0 },
  });
  return res.status(200).json(new ApiResponse(200, await publicUser(userId), "Email confirmed. You can sign in now."));
};

export const resendVerificationEmail = async (req, res) => {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  // Same answer whether or not the account exists, so emails can't be probed
  const generic = new ApiResponse(200, {}, "If that account exists and isn't confirmed yet, a new code is on its way.");
  if (!user || user.isVerified) return res.status(200).json(generic);

  const code = await issueCode(user, "verification");
  if (code) await deliverCode({ purpose: "verification", to: user.email, name: user.fullname, code, expiresIn: "24 hours" });
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

  const { accessToken, refreshToken } = await startSession(user, ROLES.USER);
  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, { user: await publicUser(user.id) }, "Signed in"));
};

export const logoutUser = async (req, res) => {
  await endSession(req.sessionId);
  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "Signed out"));
};

export const refreshAccessToken = async (req, res) => {
  const incoming = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!incoming) throw new ApiError(401, "Sign in again.");

  const { tokens } = await rotateSession(incoming, ROLES.USER);
  const { accessToken, refreshToken } = tokens;
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
  // Anyone signed in elsewhere with the old password is signed out; this device stays signed in
  await endSessionsFor({ userId: user.id }, { except: req.sessionId });
  return res.status(200).json(new ApiResponse(200, {}, "Password changed. You've been signed out on other devices."));
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  const generic = new ApiResponse(200, {}, "If that account exists, a reset code is on its way.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(200).json(generic);

  const code = await issueCode(user, "reset");
  if (code) await deliverCode({ purpose: "password reset", to: user.email, name: user.fullname, code, expiresIn: "10 minutes" });
  return res.status(200).json(generic);
};

// Checking the code here uses up an attempt too, so the check-then-reset flow takes two of them
export const verifyResetToken = async (req, res) => {
  const userId = await checkCode("reset", req.body.email, req.body.token);
  if (!userId) throw new ApiError(400, "That code is wrong or has expired. Ask for a new one.");
  return res.status(200).json(new ApiResponse(200, { verified: true }, "Code accepted"));
};

export const resetPassword = async (req, res) => {
  const { email, token, newPassword } = req.body;
  const userId = await checkCode("reset", email, token);
  if (!userId) throw new ApiError(400, "That code is wrong or has expired. Ask for a new one.");

  await prisma.user.update({
    where: { id: userId },
    data: {
      password: await hashPassword(newPassword),
      passwordResetToken: null,
      passwordResetExpires: null,
      passwordResetAttempts: 0,
    },
  });
  await endSessionsFor({ userId });
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
