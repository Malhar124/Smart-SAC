-- Removing an item no longer deletes its loans: late returns and busy-time history stay.
-- The loan keeps its roll number and times; only the link to the removed item becomes null.

-- DropForeignKey
ALTER TABLE "Loan" DROP CONSTRAINT "Loan_equipmentId_fkey";

-- AlterTable
ALTER TABLE "Loan" ALTER COLUMN "equipmentId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
