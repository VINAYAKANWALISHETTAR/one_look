/** Zod helpers — every request body/param is validated before it reaches SQL. */

import { z } from "zod";
import { badRequest } from "./http-error.js";

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      "Invalid request.",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const clockTime = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM");
export const isoTimestamp = z.string().datetime({ offset: true });

export { z };
