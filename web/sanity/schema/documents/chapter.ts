import { defineType } from "sanity";

export const chapterSchema = defineType({
  name: "chapter",
  type: "document",
  title: "Chapter",
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
      name: "course",
      type: "reference",
      title: "Course",
      to: [
        {
          type: "course",
        },
      ],
    },
  ],
});
