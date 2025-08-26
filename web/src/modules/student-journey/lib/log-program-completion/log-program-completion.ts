/**
 * Records completion of an internal program as a `StudentCourse` entry.
 *
 * When a `ProgramApplication` is marked `COMPLETED`, internal programs should
 * surface automatically on the student's timeline. This helper ensures the
 * corresponding `Course` exists (keyed to the `Program`) and then creates a
 * `StudentCourse` row for the user. Each run increments the attempt count so
 * repeat enrollments remain distinct.
 */
import {
  CourseSourceType,
  Program,
  ProgramApplication,
  StudentCourseStatus,
} from "@prisma/client";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export async function logProgramCompletion(
  application: ProgramApplication & { program?: Program | null },
) {
  if (!application.programId) return;

  // Reuse or create a course linked to the program to avoid duplicated metadata.
  const course = await prisma.course.upsert({
    where: { programId: application.programId },
    update: {},
    create: {
      programId: application.programId,
      title: application.program?.name ?? "Program",
      description: application.program?.description ?? undefined,
      sourceType: CourseSourceType.INTERNAL,
    },
  });

  // Determine how many times the student has completed this course.
  const attemptCount = await prisma.studentCourse.count({
    where: { userId: application.userId, courseId: course.id },
  });

  await prisma.studentCourse.create({
    data: {
      userId: application.userId,
      courseId: course.id,
      status: StudentCourseStatus.VERIFIED,
      attempt: attemptCount + 1,
      completedAt: application.completedAt ?? new Date(),
    },
  });
}
