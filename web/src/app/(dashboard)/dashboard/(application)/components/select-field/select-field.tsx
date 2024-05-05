"use client";

import { FormControl, FormLabel, MenuItem, Select } from "@mui/material";
import { useAtom } from "jotai";
import { ApplicationSchemaItem } from "../../atoms/application.atom";
import { ApplicationMarkdown } from "../application-markdown/application-markdown";

export function SelectField({
  label,
  valueAtom,
  options,
}: ApplicationSchemaItem) {
  const [value, setValue] = useAtom<string>(valueAtom);
  return (
    <div>
      <FormControl>
        <ApplicationMarkdown label={label} />
        <FormLabel>
          <Select
            value={value || ""}
            onChange={(e) => setValue(e.target.value)}
          >
            <MenuItem value="">Select your institution</MenuItem>
            {options?.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormLabel>
      </FormControl>
    </div>
  );
}
