import { Typography } from "@mui/material";
import Markdown from "react-markdown";

export function ApplicationMarkdown({ label }: { label: string }) {
  return (
    <Typography
      component="div"
      sx={{ "& a": { color: "white" }, "& p": { my: 0 } }}
    >
      <Markdown
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {label}
      </Markdown>
    </Typography>
  );
}
