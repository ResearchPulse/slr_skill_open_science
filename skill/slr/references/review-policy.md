# SLR review policy

## Evidence workflow

1. Read the project research questions, inclusion criteria, exclusion criteria, and task instructions.
2. Read the paper title, abstract, metadata, and full text when available.
3. Separate direct evidence from inference. Identify section/page or passage references when the Markdown provides them.
4. Select `INCLUDE`, `EXCLUDE`, or `UNCERTAIN`, unless the project uses another documented decision vocabulary.
5. Explain the decision in concise evidence-based language.
6. Add structured `data` only when it helps the project; omit unknown values instead of inventing them.

## Draft template

```json
{
  "decision": "INCLUDE",
  "reasoning": "The study matches the population and intervention criteria because ...",
  "data": {
    "population": "...",
    "intervention": "...",
    "outcomes": ["..."],
    "evidence": ["..."],
    "confidence": 0.91,
    "sourceSections": ["..."],
    "uncertainties": ["..."]
  }
}
```

The schema is flexible, but `data` must remain a JSON object. Do not add chain-of-thought or hidden reasoning. Provide only the concise rationale needed to support the screening decision.

## Confirmation wording

Use an explicit question:

```text
This will mark task <taskId> as completed in the SLR project.
Decision: <decision>
Reasoning: <reasoning>
Data: <data>

Do you confirm recording this result? Reply `confirm` or `cancel`.
```

Treat anything other than a clear affirmative response as no confirmation.
