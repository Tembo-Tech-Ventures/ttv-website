"use client";

import { FormControl, FormLabel, Switch } from "@mui/material";
import { useAtom } from "jotai";
import { ApplicationSchemaItem } from "../../atoms/application.atom";
import { ApplicationMarkdown } from "../application-markdown/application-markdown";

export function BooleanField({ label, valueAtom }: ApplicationSchemaItem) {
  const [value, setValue] = useAtom<boolean>(valueAtom);
  return (
    <div>
      <FormControl>
        <ApplicationMarkdown label={label} />
        <FormLabel>
          <small>No</small>
          <Switch
            checked={value}
            onChange={(e) => setValue(e.target.checked)}
          />
          <small>Yes</small>
        </FormLabel>
      </FormControl>
    </div>
  );
}
