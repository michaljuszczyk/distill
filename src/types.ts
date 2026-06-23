import { z } from "zod";

export const AntiBiasTechniqueSchema = z.enum(["devils_advocate", "pre_mortem", "unknown_unknowns"]);
export type AntiBiasTechnique = z.infer<typeof AntiBiasTechniqueSchema>;

export const ArtifactSchema = z.object({
  needs: z.array(z.string().min(1)).min(1),
  criteria: z.array(z.string().min(1)).min(1),
  options: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const NewDecisionInputSchema = z.object({
  description: z.string().min(1),
  summary: z.string().min(1),
  artifact: ArtifactSchema,
  anti_bias_technique: AntiBiasTechniqueSchema,
});
export type NewDecisionInput = z.infer<typeof NewDecisionInputSchema>;

export type Decision = NewDecisionInput & {
  id: string;
  user_id: string;
  title: string;
  note: string;
  acknowledged_at: string;
  created_at: string;
};

// The only user-mutable fields on a saved decision. The AI artifact stays
// immutable, so it is intentionally absent here.
export const UpdateDecisionInputSchema = z
  .object({
    title: z.string().max(200).optional(),
    note: z.string().max(2000).optional(),
  })
  .refine((d) => d.title !== undefined || d.note !== undefined, {
    message: "provide at least one of title or note",
  });
export type UpdateDecisionInput = z.infer<typeof UpdateDecisionInputSchema>;

// --- wizard ---

export const QAPairSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});
export type QAPair = z.infer<typeof QAPairSchema>;

export const SocraticRequestSchema = z.object({
  description: z.string().min(1),
  priorAnswers: z
    .object({
      round1: QAPairSchema.array().optional(),
      round2: QAPairSchema.array().optional(),
    })
    .optional(),
});
export type SocraticRequest = z.infer<typeof SocraticRequestSchema>;

export const SocraticResponseSchema = z.object({
  questions: z.string().min(1).array().min(3).max(6),
  needsFollowUp: z.boolean(),
});
export type SocraticResponse = z.infer<typeof SocraticResponseSchema>;

export const AlternativeSchema = z.object({
  title: z.string().min(1),
  pros: z.string().min(1).array().min(1),
  cons: z.string().min(1).array().min(1),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const SocraticPayloadSchema = z.object({
  round1: QAPairSchema.array().min(1),
  round2: QAPairSchema.array().optional(),
});
export type SocraticPayload = z.infer<typeof SocraticPayloadSchema>;

export const AlternativesRequestSchema = z.object({
  description: z.string().min(1),
  socratic: SocraticPayloadSchema,
});
export type AlternativesRequest = z.infer<typeof AlternativesRequestSchema>;

export const AlternativesResponseSchema = z.object({
  alternatives: AlternativeSchema.array().length(3),
});
export type AlternativesResponse = z.infer<typeof AlternativesResponseSchema>;

export const AntiBiasRequestSchema = z.object({
  description: z.string().min(1),
  socratic: SocraticPayloadSchema,
  alternatives: AlternativeSchema.array().length(3),
  technique: AntiBiasTechniqueSchema,
});
export type AntiBiasRequest = z.infer<typeof AntiBiasRequestSchema>;

export const AntiBiasResponseSchema = z.object({
  markdown: z.string().min(1),
});
export type AntiBiasResponse = z.infer<typeof AntiBiasResponseSchema>;

export const ArtifactRequestSchema = z.object({
  description: z.string().min(1),
  socratic: SocraticPayloadSchema,
  alternatives: AlternativeSchema.array().length(3),
  technique: AntiBiasTechniqueSchema,
  antiBiasMarkdown: z.string().min(1),
});
export type ArtifactRequest = z.infer<typeof ArtifactRequestSchema>;

export const ArtifactResponseSchema = ArtifactSchema.extend({
  summary: z.string().min(1),
});
export type ArtifactResponse = z.infer<typeof ArtifactResponseSchema>;
