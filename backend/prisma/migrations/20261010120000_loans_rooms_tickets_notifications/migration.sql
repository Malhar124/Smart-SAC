-- CreateEnum
CREATE TYPE "TicketKind" AS ENUM ('broken', 'request');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('created', 'status_changed', 'comment');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('reservation_expiring', 'reservation_expired', 'due_soon', 'overdue', 'ticket_updated', 'ticket_reply', 'announcement', 'room_booking_soon', 'room_booking_cancelled');

-- AlterEnum
-- "occupied" and "reserved" are now expressed by RoomBooking rows, so those rooms become bookable
BEGIN;
UPDATE "Room" SET "status" = 'available' WHERE "status" IN ('occupied', 'reserved');
CREATE TYPE "RoomStatus_new" AS ENUM ('available', 'maintenance');
ALTER TABLE "public"."Room" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Room" ALTER COLUMN "status" TYPE "RoomStatus_new" USING ("status"::text::"RoomStatus_new");
ALTER TYPE "RoomStatus" RENAME TO "RoomStatus_old";
ALTER TYPE "RoomStatus_new" RENAME TO "RoomStatus";
DROP TYPE "public"."RoomStatus_old";
ALTER TABLE "Room" ALTER COLUMN "status" SET DEFAULT 'available';
COMMIT;

-- DropForeignKey
ALTER TABLE "Room" DROP CONSTRAINT "Room_bookedById_fkey";

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "reservationRemindedAt" TIMESTAMP(3);

-- Items already out had a free-text duration ("1h", "1h 30m", "2 hours"). Turn it into a due time
-- counted from when the item last changed, defaulting to one hour when the text can't be read.
UPDATE "Equipment"
SET "issuedAt" = "updatedAt",
    "dueAt" = "updatedAt" + CASE
      WHEN substring("duration" from '(\d+)\s*h') IS NULL AND substring("duration" from '(\d+)\s*m') IS NULL
        THEN interval '1 hour'
      ELSE make_interval(
        hours => coalesce(substring("duration" from '(\d+)\s*h')::int, 0),
        mins  => coalesce(substring("duration" from '(\d+)\s*m')::int, 0))
    END
WHERE "status" = 'in-use';

ALTER TABLE "Equipment" DROP COLUMN "duration";

-- AlterTable
ALTER TABLE "EquipmentHistory" DROP COLUMN "duration",
ADD COLUMN     "changedById" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Room" DROP COLUMN "bookedById",
DROP COLUMN "currentActivity",
DROP COLUMN "timeSlot",
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Ticket" DROP COLUMN "footer",
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "TicketKind" NOT NULL DEFAULT 'broken',
ADD COLUMN     "requestedGame" TEXT,
ADD COLUMN     "requestedItem" TEXT;

-- CreateTable
CREATE TABLE "RoomBooking" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByAdminId" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "userId" TEXT,
    "roll_no" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "fromReservation" BOOLEAN NOT NULL DEFAULT false,
    "issuedById" TEXT,
    "returnedToId" TEXT,
    "dueSoonNotifiedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" "TicketEventType" NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus",
    "body" TEXT,
    "authorUserId" TEXT,
    "authorAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomBooking_roomId_startsAt_idx" ON "RoomBooking"("roomId", "startsAt");

-- CreateIndex
CREATE INDEX "RoomBooking_userId_startsAt_idx" ON "RoomBooking"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "Loan_equipmentId_returnedAt_idx" ON "Loan"("equipmentId", "returnedAt");

-- CreateIndex
CREATE INDEX "Loan_roll_no_issuedAt_idx" ON "Loan"("roll_no", "issuedAt");

-- CreateIndex
CREATE INDEX "Loan_returnedAt_dueAt_idx" ON "Loan"("returnedAt", "dueAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "EquipmentHistory_equipmentId_changedAt_idx" ON "EquipmentHistory"("equipmentId", "changedAt");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentHistory" ADD CONSTRAINT "EquipmentHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_cancelledByAdminId_fkey" FOREIGN KEY ("cancelledByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_returnedToId_fkey" FOREIGN KEY ("returnedToId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every item that is out right now gets an open loan, so overdue tracking covers it
INSERT INTO "Loan" ("id", "equipmentId", "userId", "roll_no", "issuedAt", "dueAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "userId", coalesce("roll_no", 'unknown'), "issuedAt", "dueAt", CURRENT_TIMESTAMP
FROM "Equipment"
WHERE "status" = 'in-use' AND "issuedAt" IS NOT NULL;

-- Backfill: existing tickets start their timeline with a "created" entry; closed ones get a close time
INSERT INTO "TicketEvent" ("id", "ticketId", "type", "toStatus", "authorUserId", "createdAt")
SELECT gen_random_uuid()::text, "id", 'created', 'open', "senderId", "createdAt"
FROM "Ticket";

UPDATE "Ticket" SET "closedAt" = "updatedAt" WHERE "status" = 'closed';
