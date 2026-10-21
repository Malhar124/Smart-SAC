import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomInt, randomUUID } from "crypto";
import { env } from "../config/env.js";

export const ROLES = { USER: "user", ADMIN: "admin" };

export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

export const isPasswordCorrect = async (password, hashedPassword) => {
  if (!password || !hashedPassword) return false;
  return await bcrypt.compare(password, hashedPassword);
};

// Cryptographically secure 6-digit code for email verification / password reset
export const generateOtp = () => randomInt(100000, 1000000).toString();

// Cookies must be `secure` with SameSite=None in production (cross-site frontend),
// but browsers drop secure cookies over plain http://localhost during development.
export const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : env.isProduction,
  sameSite: env.COOKIE_SAMESITE ?? (env.isProduction ? "none" : "lax"),
  path: "/",
};

// `role` is embedded in both tokens so a user token can never pass the admin middleware (and vice versa).
// `sid` names the Session row; both tokens stop working when it's deleted.
export const generateAccessToken = (account, role, sessionId) => {
  return jwt.sign(
    {
      _id: account.id,
      email: account.email,
      username: account.username,
      fullname: account.fullname,
      role,
      sid: sessionId,
    },
    env.ACCESS_TOKEN_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRY }
  );
};

// `jti` makes every refresh token unique, even two issued in the same second
export const generateRefreshToken = (account, role, sessionId) => {
  return jwt.sign({ _id: account.id, role, sid: sessionId, jti: randomUUID() }, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRY,
  });
};

export const verifyRefreshToken = (token) => jwt.verify(token, env.REFRESH_TOKEN_SECRET);

/** Roll numbers are stored upper-case so "iit2023042" and "IIT2023042" are the same student */
export const normalizeRollNo = (rollNo) => rollNo.trim().toUpperCase();
