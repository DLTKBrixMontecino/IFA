Call `consolidate_evidence` with `$ARGUMENTS`. Route each bundle by `suggestedPhase`:
- 7 → Phase 7 write-up directly. Do NOT call Phase 4 or Phase 5.
- 6 → `read_screenshot` → Phase 7. Do NOT call Phase 4 or Phase 5.
- 4 → Phase 4 AI → root cause: Phase 7 | suspicious: Phase 6 → Phase 7 | nothing: Phase 5 → Phase 6 → Phase 7

Multiple failures: process each bundle independently.

Phase 7 write-up: reason over `failingStep` only first. Consult `precedingSteps` and `keywordDefinition` only if the failing step alone is ambiguous. Write three labelled sections per failure — **What the evidence shows**, **AI Assessment**, **AI Defect Classification** — plain English for QEs, no recommendation. AI Defect Classification reflects the root cause from the AI Assessment — not the test failure mechanism (e.g. an assertion-triggered failure caused by bad data = Data Issue, not Assertion Failure). Use Assertion Failure only when the test expectation itself is wrong. One label from: Click Failure, Connectivity Issue, Product Bug, System Error, Script Error, Pre-Req Error, Data Issue, Duplicate Data, Assertion Failure, Settings Issue, Keyword Issue, Pipeline Issue, Pipeline Timeout.

Output the write-up directly — no preamble, no routing labels (e.g. "Phase 4 → Phase 7"), no introductory sentences before the first section header.
