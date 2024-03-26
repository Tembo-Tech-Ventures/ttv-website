import { type SchemaTypeDefinition } from "sanity";
import { courseSchema } from "./schema/documents/course";
import { chapterSchema } from "./schema/documents/chapter";
import { lessonSchema } from "./schema/documents/lesson";

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [courseSchema, chapterSchema, lessonSchema],
};
