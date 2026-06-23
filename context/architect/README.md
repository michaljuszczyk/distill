# Architect Badge — Module 4 Artifacts

These are the **10xDevs Module 4 / Architect-badge deliverables**. They were produced by
analyzing the **`bitwarden-server`** codebase — a large, real legacy C#/.NET project — and
therefore describe _that_ repo, **not** this project (`distill`).

They are copied here, under version control, for badge submission and provenance: in the
source repo they exist only as untracked working files with no git history.

## The four required artifacts + capstone

| #        | Artifact                                   | Files                                                                                                        | Lesson |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------ |
| ①        | Repository map                             | `map/repo-map.md` (+ `map/artifact-1-territory.md`, `artifact-2-structure.md`, `artifact-3-contributors.md`) | M4L2   |
| ② / ③    | Feature overview + technical-debt analysis | `changes/org-member-invite/research.md` (+ `_trace`, `_intent`, `_blast-radius`, `_test-gaps`)               | M4L3   |
| ④        | Refactor opportunities + phased plan       | `changes/refactor-opportunities/research.md`, `plan.md`                                                      | M4L4   |
| ⑤        | DDD domain notes                           | `domain/01-domain-distillation.md`, `02-invariant-aggregate-refactor.md`, `03-anti-corruption-layer.md`      | M4L5   |
| capstone | Architectural report (~2 pages)            | `architect-report.md`                                                                                        | M4L5   |

## Verification notes

- Structural claims were verified with **`ast-grep`** — see the verification tables (with
  confirmed/refined/refuted tallies) in the research docs.
- **dependency-cruiser / madge** were not applicable (JS-only tools; `bitwarden-server` is
  C#/.NET). A deterministic `.csproj` `<ProjectReference>` + `.slnx` graph was used instead,
  documented in `map/artifact-2-structure.md`.
