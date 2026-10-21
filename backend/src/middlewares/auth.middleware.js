import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { prisma } from "../db/index.js";
import { isStaffEmail, ROLES } from "../utils/auth.js";
import { env } from "../config/env.js";

export const USER_PUBLIC_FIELDS = {
  id: true,
  fullname: true,
  email: true,
  username: true,
  roll_no: true,
  phone_number: true,
  isVerified: true,
  achievements: true,
  description: true,
  createdAt: true,
  updatedAt: true,
};

export const ADMIN_PUBLIC_FIELDS = { id: true, email: true, name: true, createdAt: true, updatedAt: true };

const readToken = (req) => req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");

const decodeAccessToken = (req) => {
  const token = readToken(req);
  if (!token) throw new ApiError(401, "Sign in to continue.");
  try {
    return jwt.verify(token, env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    throw new ApiError(401, error?.name === "TokenExpiredError" ? "Your session expired." : "Invalid access token.");
  }
};

/**
 * The account behind an access token, read through its session in one query. A token whose session
 * was ended (sign-out, password change, replayed refresh token) stops working at once, not when it expires.
 */
const loadAccount = async (decoded) => {
  if (!decoded.sid) throw new ApiError(401, "Your session expired.");
  const session = await prisma.session.findUnique({
    where: { id: decoded.sid },
    select: { user: { select: USER_PUBLIC_FIELDS }, admin: { select: ADMIN_PUBLIC_FIELDS } },
  });
  const account = decoded.role === ROLES.ADMIN ? session?.admin : session?.user;
  if (!account) throw new ApiError(401, "Your session ended. Sign in again.");
  if (decoded.role === ROLES.ADMIN && !isStaffEmail(account.email)) {
    throw new ApiError(401, "This account isn't on the staff list any more.");
  }
  return account;
};

/** Sets req.user (the student or staff member), req.account and req.sessionId */
const authenticate = async (req, decoded) => {
  req.user = await loadAccount(decoded);
  req.account = { kind: decoded.role === ROLES.ADMIN ? "admin" : "user", id: req.user.id };
  req.sessionId = decoded.sid;
};

/** Students only */
export const requireUser = async (req, res, next) => {
  const decoded = decodeAccessToken(req);
  if (decoded?.role !== ROLES.USER) throw new ApiError(401, "Sign in with a student account.");
  await authenticate(req, decoded);
  next();
};

/** SAC staff only */
export const requireAdmin = async (req, res, next) => {
  const decoded = decodeAccessToken(req);
  if (decoded?.role !== ROLES.ADMIN) throw new ApiError(401, "Sign in with a staff account.");
  await authenticate(req, decoded);
  next();
};

/** Either kind of account, e.g. the live events stream */
export const requireAccount = async (req, res, next) => {
  const decoded = decodeAccessToken(req);
  if (decoded?.role !== ROLES.ADMIN && decoded?.role !== ROLES.USER) throw new ApiError(401, "Invalid access token.");
  await authenticate(req, decoded);
  next();
};
