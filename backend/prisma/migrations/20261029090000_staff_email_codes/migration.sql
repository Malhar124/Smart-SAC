-- Staff sign-up proves the email with a 6-digit code, like student sign-up.
-- Additive only: existing staff keep their passwords.

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailVerificationExpires" TIMESTAMP(3),
ADD COLUMN     "emailVerificationToken" TEXT;
