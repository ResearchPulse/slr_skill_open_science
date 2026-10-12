# SLR review policy

## Evidence workflow

1. Read the project research questions, inclusion criteria, exclusion criteria, and task instructions.
2. Read the paper title, abstract, metadata, and full text when available.
3. Separate direct evidence from inference. Identify section/page or passage references when the Markdown provides them.
4. Select `INCLUDE`, `EXCLUDE`, or `UNCERTAIN`, unless the project uses another documented decision vocabulary.
5. Explain the decision in concise evidence-based language.
6. Add structured `data` only when it helps the project; omit unknown values instead of inventing them.

## Decision rules

Apply these rules in order:

1. Check hard exclusion criteria first. One clear exclusion is enough for `EXCLUDE`,
   but mention other observed exclusions when relevant.
2. Check every inclusion criterion and mark it `met`, `not_met`, or `unclear` with
   evidence. Any clear `not_met` means `EXCLUDE`; all `met` means `INCLUDE`; otherwise
   use `UNCERTAIN`.
3. Task instructions override the default rubric when they add or tighten a rule.
4. When the evidence is between `INCLUDE` and `EXCLUDE`, choose `UNCERTAIN` so a
   human can resolve the ambiguity.

Common hard-exclusion signals include the wrong population or age group, a non-human
study when humans are required, the wrong study design, an out-of-range date or
language, a duplicate publication, or no relevant outcome.

## Confidence and traceability

Use `data.confidence` from 0 to 1: 0.9-1.0 when explicit statements settle every
criterion, 0.7-0.89 when one criterion relies on a reasonable inference, and
0.5-0.69 for a judgement call that normally pairs with `UNCERTAIN`. Below 0.5,
do not use `INCLUDE` or `EXCLUDE`; choose `UNCERTAIN`.

Reasoning should begin with `Decision:`, `Basis:`, and `Key reason:` lines so local
draft summaries remain useful. Every criterion claim must point to a paper section,
page, or short passage when the full text provides one. Do not invent numbers or
quotes.

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
