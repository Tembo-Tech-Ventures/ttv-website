/*
  Warnings:

  - Added the required column `curriculumId` to the `Program` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "curriculumId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ProgramApplication" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Curriculum" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Curriculum_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
