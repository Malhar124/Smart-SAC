import { timingSafeEqual } from "crypto";
import { prisma } from "../db/index.js";
import { generateOtp } from "../utils/auth.js";
import { CODE_RESEND_SECONDS, DAY, MAX_CODE_ATTEMPTS, MINUTE } from "../config/policy.js";

// Emailed 6-digit codes, for students (`user`) and staff (`admin`); both tables use the same field names

export const CODE_FIELDS = {
  verification: { token: "emailVerificationToken", expires: "emailVerificationExpires", attempts: "emailVerificationAttempts", ttl: DAY },
  reset: { token: "passwordResetToken", expires: "passwordResetExpires", attempts: "passwordResetAttempts", ttl: 10 * MINUTE },
};

const sameCode = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Check an emailed code. Each check uses up one of MAX_CODE_ATTEMPTS *before* comparing, so guesses
 * sent all at once from many addresses still get only that many tries at a 6-digit code; after that
 * the person asks for a new one. Returns the account's id when the code matches.
 */
export const checkCode = async (kind, email, token, model = "user") => {
  const f = CODE_FIELDS[kind];
  const { count } = await prisma[model].updateMany({
    where: { email, [f.token]: { not: null }, [f.expires]: { gt: new Date() }, [f.attempts]: { lt: MAX_CODE_ATTEMPTS } },
    data: { [f.attempts]: { increment: 1 } },
  });
  if (count === 0) return null;
  const account = await prisma[model].findUnique({ where: { email }, select: { id: true, [f.token]: true } });
  return account?.[f.token] && sameCode(account[f.token], token) ? account.id : null;
};

/** A fresh code for `account`, or null when one went out in the last CODE_RESEND_SECONDS (no email bombing) */
export const issueCode = async (account, kind, model = "user") => {
  const f = CODE_FIELDS[kind];
  const sentAt = account[f.expires] ? account[f.expires].getTime() - f.ttl : 0;
  if (Date.now() - sentAt < CODE_RESEND_SECONDS * 1000) return null;
  const code = generateOtp();
  await prisma[model].update({
    where: { id: account.id },
    data: { [f.token]: code, [f.expires]: new Date(Date.now() + f.ttl), [f.attempts]: 0 },
  });
  return code;
};
