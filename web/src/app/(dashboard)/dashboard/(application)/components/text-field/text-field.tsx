"use client";

import {
  FormControl,
  FormLabel,
  TextField as MUITextField,
} from "@mui/material";
import { useAtom } from "jotai";
import { ApplicationSchemaItem } from "../../atoms/application.atom";
import { ApplicationMarkdown } from "../application-markdown/application-markdown";

export function TextField({ label, valueAtom }: ApplicationSchemaItem) {
  const [value, setValue] = useAtom<string>(valueAtom);
  return (
    <div>
      <FormControl>
        <ApplicationMarkdown label={label} />
        <FormLabel>
          <MUITextField
            value={value || ""}
            onChange={(e) => setValue(e.target.value)}
            sx={{ pt: 2, minWidth: (theme) => theme.breakpoints.values.sm }}
          />
        </FormLabel>
      </FormControl>
    </div>
  );
}
