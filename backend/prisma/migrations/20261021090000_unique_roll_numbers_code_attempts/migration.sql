-- Roll numbers are stored upper-case and trimmed; older rows may not be.
-- If two accounts share a roll number after this, the unique index below fails: decide which
-- account owns it (the desk can check the student's ID card) and fix or remove the other first.
UPDATE "User" SET "roll_no" = UPPER(TRIM("roll_no")) WHERE "roll_no" <> UPPER(TRIM("roll_no"));

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passwordResetAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "User_roll_no_key" ON "User"("roll_no");
