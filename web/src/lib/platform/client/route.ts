import type { ZodType } from "zod";

/** Structural bridge until the backend contracts land. Keep this shape compatible. */
export interface RouteDef<P, Q, B, R> {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  params?: ZodType<P>;
  query?: ZodType<Q>;
  body?: ZodType<B>;
  response: ZodType<R>;
  idempotent?: boolean;
}
