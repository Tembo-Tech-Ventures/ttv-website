-- CreateEnum
CREATE TYPE "ProgramRoleName" AS ENUM ('INSTRUCTOR', 'TA');

-- CreateTable
CREATE TABLE "ProgramRole" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" "ProgramRoleName" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramRole_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProgramRole" ADD CONSTRAINT "ProgramRole_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramRole" ADD CONSTRAINT "ProgramRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
