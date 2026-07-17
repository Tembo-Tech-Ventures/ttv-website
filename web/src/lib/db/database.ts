import type { drizzle } from "drizzle-orm/d1";
import type * as schema from "@/lib/db/schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
