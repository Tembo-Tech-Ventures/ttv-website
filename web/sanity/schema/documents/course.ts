import { defineType } from "sanity";

export const courseSchema = defineType({
  name: "course",
  type: "document",
  title: "Course",
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
  ],
});
