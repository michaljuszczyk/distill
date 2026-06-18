import { z } from "zod";

// Single source of truth for the review output. The rubric (incl. the 1-10
// range) lives in .describe() — structured output rejects .min()/.max() on int.
export const reviewSchema = z.object({
  correctness: z
    .number()
    .int()
    .describe(
      "Score 1-10. Does the code do what it intends? Logic errors, edge cases, off-by-one, null handling. 1=broken, 10=provably correct.",
    ),
  security: z
    .number()
    .int()
    .describe(
      "Score 1-10. Injection, secrets in code, authz/authn gaps, unsafe input handling. 1=exploitable, 10=hardened.",
    ),
  maintainability: z
    .number()
    .int()
    .describe(
      "Score 1-10. Naming, structure, duplication, complexity, comments. 1=unreadable, 10=clean and idiomatic.",
    ),
  testCoverage: z
    .number()
    .int()
    .describe(
      "Score 1-10. Are changed paths covered by tests? Meaningful assertions, edge cases. 1=none, 10=thorough.",
    ),
  performance: z
    .number()
    .int()
    .describe(
      "Score 1-10. Needless allocations, N+1 queries, blocking I/O, algorithmic cost. 1=pathological, 10=efficient.",
    ),
  verdict: z
    .enum(["pass", "fail"])
    .describe("Binding gate. 'fail' if any criterion is a blocker (security hole, broken logic), else 'pass'."),
  summary: z
    .string()
    .describe(
      "Short markdown summary: top findings and the single most important fix. Reference files/lines from the diff.",
    ),
});

export type Review = z.infer<typeof reviewSchema>;
