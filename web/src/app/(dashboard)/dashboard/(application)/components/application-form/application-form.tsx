"use client";

import { ProgramApplication, ProgramPartner } from "@prisma/client";
import { useAtom } from "jotai";
import { useEffect } from "react";
import {
  applicationSchema,
  setApplicationValuesAtom,
} from "../../atoms/application.atom";
import { BooleanField } from "../boolean-field/boolean-field";
import { SelectField } from "../select-field/select-field";
import { TextField } from "../text-field/text-field";
import { TextAreaField } from "../textarea-field/textarea-field";

export function ApplicationForm({
  existing,
  partners,
}: {
  existing?: ProgramApplication;
  partners: ProgramPartner[];
}) {
  const [, setApplicationValues] = useAtom(setApplicationValuesAtom);

  useEffect(() => {
    const existingApplication = (existing?.application as any)
      ?.submission as typeof applicationSchema;

    if (existingApplication) {
      applicationSchema.forEach(({ valueAtom, name }) => {
        const value = (
          existingApplication.find((item) => item.name === name) as any
        ).value;
        setApplicationValues({ atom: valueAtom, value });
      });
    }
  }, [existing?.application, setApplicationValues]);

  return (
    <>
      {applicationSchema.map((item) => {
        if (item.name === "partnerId") {
          item.options = partners.map((partner) => ({
            label: partner.name,
            value: partner.id,
          }));
        }
        if (item.type === "requiredBoolean") {
          return <BooleanField key={item.name} {...item} />;
        }
        if (item.type === "textarea") {
          return <TextAreaField key={item.name} {...item} />;
        }
        if (item.type === "string") {
          if (!item.options) return <TextField key={item.name} {...item} />;
          else return <SelectField key={item.name} {...item} />;
        }
      })}
    </>
  );
}
