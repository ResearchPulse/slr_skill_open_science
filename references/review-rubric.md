# Screening rubric and output format

## Decision rules

Apply in this order:

1. **Hard exclusion first.** Check each exclusion criterion. If the paper clearly meets one
   → `EXCLUDE`. One clear hit is enough; still mention any others you noticed.
2. **Inclusion check.** For each inclusion criterion mark it `met`, `not_met` or
   `unclear`, with evidence.
   - Any `not_met` (clearly) → `EXCLUDE`.
   - All `met` → `INCLUDE`.
   - Otherwise (some `unclear`, none `not_met`) → `UNCERTAIN`.
3. **Task instructions win.** If the task `instructions` add or tighten rules (e.g.
   "exclude conference abstracts", "title/abstract screening only"), follow them.
4. **When torn between INCLUDE and EXCLUDE, choose UNCERTAIN.** A wrongly excluded paper
   is lost forever; an UNCERTAIN gets a human look.

Common hard-exclusion signals: wrong population or age group, non-human/animal study when
humans are required, wrong study design (review, editorial, protocol, commentary when
primary studies are required), publication date or language outside range, duplicate
publication, no relevant outcome reported.

## Confidence

`confidence` in `data` is 0–1:

- 0.9–1.0 explicit statements in the paper settle every criterion
- 0.7–0.89 decision is solid but one criterion relies on inference
- 0.5–0.69 judgement call (usually pairs with UNCERTAIN)
- below 0.5 do not use INCLUDE/EXCLUDE; vote UNCERTAIN

## Reasoning template (reasoning file, Markdown, ideally < 2,500 chars)

Always start with the `Decision:`, `Basis:` and `Key reason:` lines — the `drafts`
summary reads `Key reason:` to build the review table.

```
Decision: EXCLUDE
Basis: full text   (or: title + abstract only — full text unavailable)

Key reason: Study population is adolescents 12–17; inclusion criterion requires adults ≥18.

Criteria:
- IC1 Adults with type 2 diabetes — NOT MET: "participants aged 12–17" (Methods).
- IC2 RCT design — MET: randomized, parallel-group (Methods).
- EC1 Non-English — not triggered.

Notes: Secondary outcomes are relevant but cannot override IC1.
```

Keep it factual and traceable: each criterion line points to where in the paper the
evidence came from. The human reviewer checks claims against the paper, so an
unsupported statement will be flagged.

## `data` object (JSON file) — required

The SLR web app renders `data.criteria` as the **Criteria assessment** panel (one expandable
row per criterion with a MET / NOT MET / UNCLEAR badge, reasoning and evidence quotes). A vote
without it shows only the free-text reasoning, so `submit_result` and `slr.py draft` **reject**
a `data` object missing `basis`, `confidence` or a complete `criteria` list.

```json
{
  "basis": "full_text",
  "confidence": 0.9,
  "keyFinding": "Population is adolescents 12-17; IC1 requires adults >=18.",
  "studyDesign": "RCT",
  "population": "Adolescents 12-17 with T2D, n=240",
  "intervention": "...",
  "comparator": "...",
  "outcomes": ["HbA1c at 24 weeks"],
  "criteria": [
    {"id": "IC1", "name": "Adults with type 2 diabetes", "status": "not_met",
     "reasoning": "Participants are adolescents, not adults.",
     "evidence": ["\"participants aged 12-17\" (Methods)"]},
    {"id": "IC2", "name": "Randomized controlled trial", "status": "met",
     "reasoning": "Randomized parallel-group design.",
     "evidence": ["\"randomized, parallel-group\" (Methods)"]},
    {"id": "EC1", "name": "Non-English publication", "status": "not_met",
     "reasoning": "Paper is in English.", "evidence": []}
  ],
  "exclusionTriggered": ["IC1 not met"]
}
```

`keyFinding` (recommended) is shown as the card's **Key finding** line — use the same text as
the reasoning's `Key reason:` line.

Rules for `criteria`:

- One item for **every** inclusion and exclusion criterion of the task's `protocolSnapshot`,
  in API order: `IC1, IC2…` for `inclusionCriteria`, then `EC1, EC2…` for `exclusionCriteria`.
- `name` = the criterion text from the snapshot (shortened if very long).
- `status` = `met` · `not_met` · `unclear`. For an exclusion criterion, `met` means the
  exclusion **is triggered** (→ EXCLUDE).
- `reasoning` = one or two sentences; `evidence` = short quotes with their location
  (`"…" (Abstract)`, `"…" (Methods, p.4)`). Use `[]` only when the paper says nothing about
  that criterion — then the status is usually `unclear`.
- Keep the whole body well under 30 KB.

`basis` is `full_text`, `partial_full_text` (fullTextStatus `PARTIAL`) or
`title_abstract`. Use `null` for other fields the paper does not report.

Set `basis` according to the task stage and the content actually reviewed. A
`TITLE_ABSTRACT` task always uses `title_abstract`; do not fetch Markdown for it. For a
`FULL_TEXT` task, use `partial_full_text` when the API reports `PARTIAL`, and `full_text`
when extraction completed normally. Assess against that task's `protocolSnapshot`, which
captures the criteria at assignment time.
