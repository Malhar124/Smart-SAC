import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { prisma } from "../db/index.js";
import { ROLES } from "../utils/auth.js";
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

const loadUser = async (id) => {
  const user = await prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_FIELDS });
  if (!user) throw new ApiError(401, "Invalid access token.");
  // Controllers written before the Prisma move read req.user._id
  user._id = user.id;
  return user;
};

const loadAdmin = async (id) => {
  const admin = await prisma.admin.findUnique({ where: { id }, select: ADMIN_PUBLIC_FIELDS });
  if (!admin) throw new ApiError(401, "Invalid access token.");
  admin._id = admin.id;
  return admin;
};

/** Students only. Sets req.user and req.account. */
export const requireUser = async (req, res, next) => {
  const decoded = decodeAccessToken(req);
  if (decoded?.role !== ROLES.USER) throw new ApiError(401, "Sign in with a student account.");
  req.user = await loadUser(decoded._id || decoded.id);
  req.account = { kind: "user", id: req.user.id };
  next();
};

/** SAC staff only. Sets req.user (the admin) and req.account. */
export const requireAdmin = async (req, res, next) => {
  const decoded = decodeAccessToken(req);
  if (decoded?.role !== ROLES.ADMIN) throw new ApiError(401, "Sign in with a staff account.");
  req.user = await loadAdmin(decoded._id || decoded.id);
  req.account = { kind: "admin", id: req.user.id };
  next();
};

/** Either kind of account, e.g. the live events stream. */
export const requireAccount = async (req, res, next) => {
  const decoded = decodeAccessToken(req);
  if (decoded?.role === ROLES.ADMIN) {
    req.user = await loadAdmin(decoded._id || decoded.id);
    req.account = { kind: "admin", id: req.user.id };
  } else if (decoded?.role === ROLES.USER) {
    req.user = await loadUser(decoded._id || decoded.id);
    req.account = { kind: "user", id: req.user.id };
  } else {
    throw new ApiError(401, "Invalid access token.");
  }
  next();
};
