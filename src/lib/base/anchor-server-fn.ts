import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { anchorRecord } from "./evidence-anchor";

const inputSchema = z.object({
  kind: z.enum(["evidence", "prediction", "settlement"]),
  id: z.string().min(1),
  agent: z.string().min(1),
  claim: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z
    .array(
      z.object({
        item: z.string(),
        source: z.string(),
        observed: z.string(),
      }),
    )
    .optional(),
  inquiry: z.string().optional(),
  observedAt: z.string().min(1),
});

export const anchorOnBase = createServerFn({ method: "POST" })
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => anchorRecord(data));
