import { createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../db/index.js";
import { ApiError } from "../utils/ApiError.js";
import { generateAccessToken, generateRefreshToken, ROLES, verifyRefreshToken } from "../utils/auth.js";

// One Session row per signed-in browser or device, so signing in on a second desk PC doesn't sign
// the first one out. Only a hash of the refresh token is stored.

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const expiryOf = (token) => new Date(jwt.decode(token).exp * 1000);
const ownerField = (role) => (role === ROLES.ADMIN ? "adminId" : "userId");

const signTokens = (account, role, sessionId) => ({
  accessToken: generateAccessToken(account, role, sessionId),
  refreshToken: generateRefreshToken(account, role, sessionId),
});

/** Sign an account in on a new device: a Session row and its first pair of tokens */
export const startSession = async (account, role) => {
  const id = randomUUID();
  const tokens = signTokens(account, role, id);
  await prisma.session.create({
    data: { id, [ownerField(role)]: account.id, tokenHash: hashToken(tokens.refreshToken), expiresAt: expiryOf(tokens.refreshToken) },
  });
  return tokens;
};

/**
 * Swap a refresh token for a new pair. Only the session's latest refresh token works: an older one
 * coming back means someone kept a copy, so the session is ended for everyone holding it.
 * `canSignIn(account)` can end the session too (staff removed from the list).
 * Returns the tokens and the account they're for.
 */
export const rotateSession = async (incoming, role, { canSignIn = () => true } = {}) => {
  const expired = new ApiError(401, "Your session expired. Sign in again.");
  let decoded;
  try {
    decoded = verifyRefreshToken(incoming);
  } catch {
    throw expired;
  }
  if (decoded.role !== role || !decoded.sid) throw expired;

  const session = await prisma.session.findUnique({ where: { id: decoded.sid }, include: { user: true, admin: true } });
  const account = role === ROLES.ADMIN ? session?.admin : session?.user;
  if (!session || !account || session.expiresAt <= new Date()) throw expired;

  const presented = hashToken(incoming);
  if (session.tokenHash !== presented || !canSignIn(account)) {
    await endSession(session.id);
    throw expired;
  }

  const tokens = signTokens(account, role, session.id);
  // Conditional on the token presented, so two refreshes racing with the same one can't both win
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, tokenHash: presented },
    data: { tokenHash: hashToken(tokens.refreshToken), expiresAt: expiryOf(tokens.refreshToken) },
  });
  if (count === 0) throw expired;
  return { tokens, account };
};

export const endSession = (sessionId) => prisma.session.deleteMany({ where: { id: sessionId } });

/** Sign an account out everywhere, e.g. after a password change. `except` keeps the current device. */
export const endSessionsFor = (owner, { except } = {}) => {
  if (!owner.userId && !owner.adminId) throw new Error("endSessionsFor needs a userId or an adminId");
  return prisma.session.deleteMany({ where: { ...owner, ...(except && { id: { not: except } }) } });
};
