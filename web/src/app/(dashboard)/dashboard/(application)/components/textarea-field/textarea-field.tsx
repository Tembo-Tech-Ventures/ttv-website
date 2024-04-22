"use client";

import { FormControl, FormLabel, TextField } from "@mui/material";
import { useAtom } from "jotai";
import { ApplicationMarkdown } from "../application-markdown/application-markdown";
import { ApplicationSchemaItem } from "../../atoms/application.atom";

export function TextAreaField({ label, valueAtom }: ApplicationSchemaItem) {
  const [value, setValue] = useAtom<string>(valueAtom);
  return (
    <div>
      <FormControl>
        <ApplicationMarkdown label={label} />
        <FormLabel>
          <TextField
            multiline
            value={value || ""}
            onChange={(e) => setValue(e.target.value)}
            sx={{ pt: 2, minWidth: (theme) => theme.breakpoints.values.sm }}
            minRows={4}
          />
        </FormLabel>
      </FormControl>
    </div>
  );
}
