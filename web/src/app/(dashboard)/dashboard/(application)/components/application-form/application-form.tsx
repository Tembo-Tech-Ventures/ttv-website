"use client";

import { ProgramApplication } from "@prisma/client";
import { useAtom } from "jotai";
import { useEffect } from "react";
import {
  applicationSchema,
  setApplicationValuesAtom,
} from "../../atoms/application.atom";
import { BooleanField } from "../boolean-field/boolean-field";
import { TextAreaField } from "../textarea-field/textarea-field";

export function ApplicationForm({
  existing,
}: {
  existing?: ProgramApplication;
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
        if (item.type === "requiredBoolean") {
          return <BooleanField key={item.name} {...item} />;
        }
        if (item.type === "textarea") {
          return <TextAreaField key={item.name} {...item} />;
        }
      })}
    </>
  );
}
