# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# IFA — Test Failure Analysis MCP Server

MCP server backing an 8-phase pipeline for diagnosing failures in BrowserFramework
(Selenium/C#, Costpoint) suite runs. Phases 1, 2, 3, 5, 8 are deterministic MCP
tools below; phases 4, 6, 7 are AI reasoning over their output (no tools).

## Setup & Commands

```bash
npm install        # install dependencies
npm run build      # compile src/ → dist/ (tsc, NodeNext modules)
npm start          # run the MCP server directly (for manual testing)
```

There are no tests or lint scripts. After any edit to `src/`, rebuild and reconnect MCP (or restart Claude Code) to pick up changes. The server is registered in `.mcp.json` as a stdio transport (`ifa-test-analysis`) running `node dist/index.js` from the project root.

**NodeNext import rule:** because `tsconfig.json` uses `"module": "NodeNext"`, all local imports in `src/` must use `.js` extensions (e.g. `import { foo } from './lib/bar.js'`) even though the source files are `.ts`. Omitting `.js` causes runtime `ERR_MODULE_NOT_FOUND`.

**After editing `src/`:** run `npm run build` then re-run `/mcp` → "ifa-test-analysis" → Reconnect in Claude Code to pick up changes.

**MCP server launch path:** `.mcp.json` specifies `node dist/index.js` with no `cwd`. Claude Code resolves this relative to the workspace root, so the workspace must be opened at the project root (where `dist/` lives) for the server to start.

**Key dependencies:** `@modelcontextprotocol/sdk` (MCP server/tool registration), `fast-xml-parser` (XML parsing in `suiteXmlParser.ts`), `glob` (file discovery), `zod` (tool parameter schemas).

**Sync vs async tools:** all tool implementations are `async` except `readScreenshot`, which is synchronous (returns `ReadScreenshotOutput` directly, not a `Promise`). `index.ts` calls it without `await`. Keep this pattern when touching that file; don't add `async`/`await` there.

## Code Architecture

```
src/
  index.ts              # MCP server bootstrap — registers all 5 tools, wires transport
  tools/                # one file per pipeline phase
    extractKeywords.ts  # Phase 1 — glob *.cs, call csharpAttributeParser, cache result
    parseSuiteResults.ts# Phase 2 — read summary.dat + per-test XML, resolve screenshots
    consolidateEvidence.ts # Phase 3 — merges Phase 1 + Phase 2 into per-failure bundles
    findPreviousRun.ts  # Phase 5 — sibling-dir scan to find prior run timestamp
    generateReport.ts   # Phase 8 — writes FailureAnalysisReport.md from AI findings
  lib/
    csharpAttributeParser.ts  # regex-based parser: [ControlType]/[Component] owners + [Keyword] attrs
    suiteXmlParser.ts         # fast-xml-parser wrappers for summary.dat and test result XMLs
    pathTranslate.ts          # toWslPath / toWindowsPath — all tool I/O uses Windows paths
    docDiffParser.ts          # regex-based parser for DocDiff output HTML → errorCount + rows[]
    keywordSourceAnalyzer.ts  # analyzeErrorInSource: strips method prefix, finds error in C# source or falls back to WebDriverWait conditions
    preRouter.ts              # deterministic pre-route check — returns suggestedPhase (4|6|7) per failure
```

**Path convention:** every tool accepts and returns Windows-style paths (`C:\...`). `pathTranslate.ts` translates to `/mnt/c/...` for actual file access on WSL. Always pass Windows paths to tools; always use `toWslPath` inside tool implementations before touching the filesystem.

**Keyword cache:** `extractFrameworkKeywords` maintains two cache layers: (1) an in-process `Map` keyed by WSL root path — free on every call after the first within the same MCP server process, (2) a disk cache at `.ifa-cache/keywords.json` in the CostpointLib root, keyed by an mtime fingerprint of all `.cs` files — used on cold process start. A full glob + parse only runs on a true cache miss (first-ever run, or after framework code changes). Use `forceRefresh: true` or `/recache-keywords` to force a re-scan. The `raw` field has been removed from `KeywordParameter` — only `index`, `type`, `label`, and `sample` are present.

**Run folder naming:** timestamped run folders use `YYYYMMDDHHmmss` (14-digit) format. `find_previous_run` relies on lexicographic sort of these names to find the prior run; the format must be preserved exactly.

**Screenshot resolution:** `parseSuiteResults` ignores the stale embedded Windows path in the XML (`EXCEPTIONIMG` log entry) and instead globs the run folder for `EXCEPTIONIMG_*.png`, picking the file whose timestamp is closest to the failing step's end time.

**DocDiff resolution:** `consolidateEvidence` checks each failing step's `OUTPUTFILE` log entry. If present, it extracts the filename by splitting on either `\` or `/` (the log path uses Windows backslashes, which `path.basename` does not split on Linux/WSL), looks for it in the suite results run folder (not the test runner machine path in the log), parses the HTML, and attaches the result as `docDiff` on the evidence bundle (`errorCount`, `compareType`, `rows[]` with `testType`/`testDetails`/`expected`/`actual`).

**Error source context:** `consolidateEvidence` populates `errorSourceContext` on each bundle when an EXCEPTIONMSG is present. It strips the method prefix from the error text, searches the keyword's source file for where that text is thrown, and returns `sourceSnippets[]` with `lineNumber` and plain-English `description`. For Selenium-generated errors not found in source (e.g. timeouts, click intercepts), it falls back to extracting all `WebDriverWait.Until()` conditions from the file. The raw `code` snippet is intentionally omitted — only `description` is included.

**Multi-instance D{VarName} check:** `preRouter` only checks the parameter slot corresponding to the failing instance (1-based) for unresolved `D{VarName}` tokens. Sibling instance slots that remain unsubstituted are ignored — this is expected for multi-instance steps.

**Token-saving output rules:** To reduce bundle size, `consolidateEvidence` strips:
- `EXCEPTIONSTACK` log entries from all failing step log messages
- Log messages from passing and not-run preceding steps (screen/keyword/parameters/status are kept)
- `raw` field from keyword parameters
- `code` field from `errorSourceContext.sourceSnippets`

**Screenshot auto-inline rules (in `index.ts`):**
- Generic System Error bundles (`suggestedPhase: 6`) → screenshot always inlined as image block
- Non-phase-6, non-DocDiff bundles where the failing step has at least one resolved (non-empty, non-`D{VarName}`) parameter → screenshot inlined for reference (no AI visual analysis triggered)
- DocDiff bundles → no screenshot inlined
- Any file read failure → skipped silently

## Pipeline

```
Phase 1  extract_framework_keywords   -> keyword catalog (cached)
Phase 2  parse_suite_results          -> failed tests + evidence from a run folder
Phase 3  consolidate_evidence         -> Phase 1 + Phase 2 merged per failure; each bundle
         includes a `route` field from preRouter.ts (suggestedPhase + reason)
         Pre-route shortcuts (deterministic, no AI cost):
         ├─ DocDiff keyword + OUTPUTFILE log entry present -> Phase 7 directly (use bundle.docDiff)
         ├─ D{VarName} in the failing instance's parameter slot -> Phase 7 directly
         ├─ ASSERT/ISEQUAL log entry present    -> Phase 7 directly
         ├─ EXCEPTIONMSG "System Error" + screenshot available -> Phase 6 directly
         └─ anything else                       -> Phase 4
Phase 4  (AI) analyze consolidated evidence -> root cause found? suspicious event? nothing?
   ├─ root cause found       -> Phase 7
   ├─ suspicious event       -> Phase 6
   └─ nothing significant    -> Phase 5
Phase 5  find_previous_run           -> prior run for the same suite, for regression diff
   ├─ root cause found (now informed by prior run) -> Phase 7
   └─ still not found                               -> Phase 6
Phase 6  read_screenshot (MCP) → returns the image for AI visual analysis.
         Skip this call if `consolidate_evidence` already inlined the screenshot — it does so
         automatically when the only log evidence is a generic "System Error was encountered"
         message (the image block appears alongside the JSON in the tool result).
         Note: for non-phase-6 bundles with resolved parameters, the screenshot is also inlined
         as a reference image (no AI analysis required — it is for corroboration only).
         Fallback: if read_screenshot fails, use the Read tool directly on the screenshotPath.
         After any fallback, diagnose why the MCP failed and patch src/tools/readScreenshot.ts.
Phase 7  (AI) final root-cause write-up — three labelled sections, plain English for QEs.
         Section headers: **What the evidence shows**, **AI Assessment**, **AI Defect Classification**.
         Sections:
         - **What the evidence shows:** Lead with the screen name and the action that failed (e.g.
           "A System Error was encountered in Project Budgets/EACs (BNP_BGMBP) while saving a record").
           Quote the exact error message the application displayed verbatim. No interpretation.
         - **AI Assessment:** What the error means in plain English — product defect, data problem, or
           environment issue. One to two sentences. Neutral where ambiguous. No technical jargon —
           write for a QE who is not a developer (avoid words like "lexicographically", "semantically", etc.).
         - **AI Defect Classification:** Pick exactly one label from this list that best fits the root
           cause identified in the AI Assessment — not the test failure mechanism. For example, if the
           test failed via an assertion but the underlying cause is bad data, classify as Data Issue,
           not Assertion Failure. Use Assertion Failure only when the test expectation itself is wrong
           (stale expected value, wrong expected string in the script).
           Labels: Click Failure, Connectivity Issue, Product Bug, System Error, Script Error,
           Pre-Req Error, Data Issue, Duplicate Data, Assertion Failure, Settings Issue, Keyword Issue,
           Pipeline Issue, Pipeline Timeout. Output only the label — no explanation.
         Rules (apply across all sections):
         - Audience is QEs, not developers — no Java/C# class or method names in the write-up
         - No recommendation or "to fix" language
         - No framework method/control names (e.g. VerifyText, WaitLoadingFinished)
         - No preamble before the write-up — output the write-up directly, no introductory sentences
         - No process commentary ("the screenshot shows", "reading the evidence")
         - For assertion failures: include expected and actual values in double quotes, taken from
           log entries (ASSERT|ISEQUAL, "Expected Result: [...]") — never from raw D{...} parameters
         - Never assume the actual result is correct; present both "stale test data" and
           "product regression" hypotheses neutrally when the cause is ambiguous
         - If the failing step's key parameter (expected message, column name, value) is an
           unresolved D{VarName} token, conclude "test script or data setup issue — expected
           value not substituted" and stop. Do not speculate about what the value should be.
           Exception: if the logs also contain an explicit application validation/error message
           (e.g. an INFO message quoting what the app displayed), that message is the root cause
           — the D{VarName} tokens are incidental loop-iteration slots, not the failing input.
         DocDiff failures (keyword = DocDiff, bundle.docDiff present):
         - **What the evidence shows:** State the screen/report name and that a document
           comparison failed. Quote errorCount and compareType from bundle.docDiff.
           List only the failing rows (where expected ≠ actual) from bundle.docDiff.rows,
           citing testDetails, expected, and actual values verbatim.
         - **AI Assessment:** State whether the discrepancies look like a data problem
           (values changed in the system) or a stale expected file (expected file not
           updated after a known change). Neutral where ambiguous.
         - **AI Defect Classification:** Pick exactly one label from the standard list (see above).
           DocDiff failures are typically Data Issue or Assertion Failure.
         - Do NOT call read_screenshot or Phase 4/5/6 for DocDiff failures — the diff
           rows are the evidence; a screenshot adds nothing.
         Phase 4 triage order (stop as soon as a confident root cause is found):
         1. Error log — read EXCEPTIONMSG and INFO messages; is the error specific enough?
            Exception: if the error is "Couldn't find control [...] within timeout", skip
            immediately to step 5 — the failing step alone cannot explain why the control
            was absent; the upstream steps are the primary evidence.
         2. Keyword definition — if the error is generic, does the keyword's purpose clarify
            what went wrong?
         3. Parameters — are the parameter values meaningful, or are they unresolved D{VarName}?
         4. Screenshot — if logs and parameters are inconclusive, escalate to Phase 6 (visual).
         5. Preceding steps (upstream logic) — check `precedingSteps` when 1–4 are inconclusive,
            OR immediately when the error is a control-not-found timeout. Look for: abnormally
            long step durations, a form or dialog closed just before the failing step, navigation
            that may not have fully settled before the next action was attempted.
Phase 8  generate_failure_report      -> writes FailureAnalysisReport.md into the run folder
```

## Slash commands

`.claude/commands/analyze.md` defines `/analyze <suiteResultsPath>` — calls `consolidate_evidence` and produces a Phase 7 root-cause write-up.

`.claude/commands/recache-keywords.md` defines `/recache-keywords` — forces a full re-scan of the C# source tree and updates the keyword cache. Run this after any BrowserFramework code change that adds, renames, or removes `[Keyword]` methods.

## How to run it

Just ask, in plain language, e.g.:

> Analyze the suite run at `C:\TFS\QEAutomation\Selenium\BrowserFramework\Products\Costpoint_711\Framework\SuiteResults\<Suite Name>\<Timestamp>` and tell me why it failed.

Claude will call `parse_suite_results` then `consolidate_evidence` on that path,
reason over the evidence (and the screenshot, and the previous run if needed),
and can call `generate_failure_report` at the end if you want a saved report.
You don't need to invoke tools by name — just give the suite results path.

## Tools

### `extract_framework_keywords`
Scans the CostpointLib C# tree for `[Keyword]` methods under `[ControlType]`/
`[Component]` classes. Result is cached under `<root>/.ifa-cache/keywords.json`,
keyed by file mtimes — free on repeat calls unless framework code changed.

- `rootPath` *(optional)* — defaults to `C:\TFS\QEAutomation\Selenium\BrowserFramework\Code\BrowserFramework\CostpointLib`.
- `forceRefresh` *(optional)* — bypass cache.

### `parse_suite_results`
Parses `summary.dat` + per-test XML in a suite run folder. Returns suite totals
and, per failed test, the failing step (keyword/control/parameters/exception
log messages) and the resolved screenshot path (found by globbing the run
folder, not the stale embedded Windows path in the XML).

- `suiteResultsPath` **(required)** — the timestamped run folder.

### `consolidate_evidence`
Runs Phase 1 + Phase 2 and merges them: each failure's keyword definition
joined with its runtime data, plus preceding steps for context. This is
normally the first/only tool call needed — it already pulls in the keyword
catalog and suite results for you.

Each bundle includes:
- `route` — `suggestedPhase` (4/6/7) + `reason` for routing decisions
- `docDiff` — parsed DocDiff HTML rows when an OUTPUTFILE log entry is present
- `errorSourceContext` — dynamically located source context for the EXCEPTIONMSG: where the error
  originates in the keyword source file (`sourceSnippets[].description` in plain English), or
  `WebDriverWait.Until()` conditions if the error is Selenium-generated
- `screenshotPath` — resolved Windows path to the exception screenshot
- Passing/not-run preceding step log messages are stripped; `EXCEPTIONSTACK` is stripped from failing step logs

- `suiteResultsPath` **(required)**
- `frameworkRootPath` *(optional)*
- `contextStepCount` *(optional, default 5)*

### `find_previous_run`
Given a run folder, finds the prior sibling run (by timestamp) for the same
suite and parses its summary, for regression comparison.

- `suiteResultsPath` **(required)** — the *current* run folder.

### `read_screenshot`
Reads a screenshot PNG/JPG from the run folder and returns it as an MCP image content
block for native visual analysis. Use the `screenshotPath` value from `consolidate_evidence`.

- `screenshotPath` **(required)** — Windows path to the screenshot file.

**Fallback:** if this tool errors (file missing, path issue), fall back to the `Read` tool
directly on the resolved WSL path. After the fallback, inspect the error and patch
`src/tools/readScreenshot.ts` to prevent the same failure next time.

### `generate_failure_report`
Writes `FailureAnalysisReport.md` (or a custom name) into the run folder from
AI-supplied findings.

- `suiteResultsPath` **(required)**
- `findings` **(required)** — array of `{ testName, rootCause, evidence[], screenshotPath?, recommendation }`
- `reportFileName` *(optional, default `FailureAnalysisReport.md`)*

**Note:** `recommendation` is a required field in the Zod schema even though Phase 7 produces no recommendation language. Pass `""` (empty string) when invoking after a Phase 7 write-up.

## Notes

- All paths in/out are Windows-style (`C:\...`) since the framework runs on
  Windows test machines; tools translate internally to `/mnt/c/...` for file
  access on this WSL box.
- `SuiteResultsManifest.xml` is stale/incomplete — `find_previous_run` scans
  sibling directories on disk directly instead of trusting it.
- One screenshot (`EXCEPTIONIMG_*.png`) per failure is the norm; if a run
  folder has several, `parse_suite_results` picks the one closest in time to
  the failing step.
