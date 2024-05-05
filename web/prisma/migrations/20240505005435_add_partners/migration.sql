-- AlterTable
ALTER TABLE "ProgramApplication" ADD COLUMN     "partnerId" TEXT;

-- CreateTable
CREATE TABLE "ProgramPartner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramPartner_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProgramApplication" ADD CONSTRAINT "ProgramApplication_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ProgramPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
