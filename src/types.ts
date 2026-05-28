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
  acknowledged_at: string;
  created_at: string;
};
