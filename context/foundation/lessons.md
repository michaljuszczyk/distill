# Lessons Learned

Project-specific recurring rules and incident learnings. Append-only — do not reorder or rewrite past entries. Use `/10x-lesson` to add a new entry when a pattern emerges that should influence future framing, research, planning, implementation, or review.

Entry format:

```markdown
## <short rule title>

- **Context**: where this rule applies (subsystem, work phase, file pattern)
- **Problem**: what breaks without the rule
- **Rule**: imperative, 1-2 sentences
- **Applies to**: frame / research / plan / plan-review / implement / impl-review / all
```

## Abort the prior stream before re-submitting

- **Context**: Any `useObject`/`streamObject` wizard step with a retry or re-pick path (`src/components/wizard/steps/*.tsx`).
- **Problem**: Re-submitting without calling `stop()` first lets an in-flight stream's `onFinish` race the new submission — the later-resolving stream wins the `*_LOADED` dispatch, pairing stale data with the new request. Recurred across reviews: fixed first in AntiBiasStep (F6), then found again in AlternativesStep.retry() and ArtifactStep.retryStream() (F1).
- **Rule**: Call `stop()` as the first statement of every retry/re-pick handler, before `submit()`.
- **Applies to**: implement / impl-review
