import { defineType } from "sanity";

export const lessonSchema = defineType({
  name: "lesson",
  type: "document",
  title: "Lesson",
  fields: [
    {
      name: "title",
      type: "string",
      title: "Title",
      validation: (Rule) => Rule.required(),
    },
    {
      name: "slug",
      type: "slug",
      title: "Slug",
      validation: (Rule) => Rule.required(),
      options: {
        source: "title",
      },
    },
    {
      name: "content",
      type: "array",
      title: "Content",
      of: [
        {
          type: "block",
        },
      ],
    },
    {
      name: "chapter",
      type: "reference",
      title: "Chapter",
      to: [
        {
          type: "chapter",
        },
      ],
    },
  ],
});
