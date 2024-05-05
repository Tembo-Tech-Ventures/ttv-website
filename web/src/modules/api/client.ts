import { AppType } from "@/app/api/v1/[[...route]]/route";
import { hc } from "hono/client";

export const client = hc<AppType>("/");
