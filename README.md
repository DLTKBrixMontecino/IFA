# IFA — Intelligent Failure Analyzer

An MCP server that powers an 8-phase pipeline for diagnosing test failures in BrowserFramework (Selenium/C#, Costpoint) suite runs. Plug it into Claude Code and analyze failures in plain English — no manual log digging.

## What it does

Given a suite results folder, IFA:
1. Extracts the keyword catalog from the C# test framework source
2. Parses failed tests from `summary.dat` and per-test XML files
3. Merges keyword definitions with runtime evidence (logs, parameters, screenshots)
4. Routes each failure to the appropriate analysis phase (AI reasoning, visual screenshot analysis, or direct DocDiff comparison)
5. Produces a plain-English root-cause write-up for QEs

## Setup

```bash
npm install
npm run build
```

The server runs as a stdio MCP transport. Register it in `.mcp.json`:

```json
{
  "mcpServers": {
    "ifa-test-analysis": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

After any source change, rebuild and reconnect: `npm run build` → `/mcp` → Reconnect in Claude Code.

## Usage

Just describe what you want in plain English in Claude Code:

> Analyze the suite run at `C:\TFS\QEAutomation\Selenium\BrowserFramework\Products\Costpoint_711\Framework\SuiteResults\<Suite Name>\<Timestamp>` and tell me why it failed.

Claude will call the pipeline tools, reason over the evidence, and deliver a root-cause write-up per failure.

## Pipeline phases

```
Phase 1  extract_framework_keywords   → keyword catalog from C# source (cached by mtime)
Phase 2  parse_suite_results          → failed tests + evidence from run folder
Phase 3  consolidate_evidence         → Phases 1+2 merged per failure; pre-router assigns route:
         ├─ DocDiff keyword + OUTPUTFILE log       → Phase 7 (diff rows are the evidence)
         ├─ Unresolved D{VarName} in failing param → Phase 7 (script/data setup issue)
         ├─ ASSERT/ISEQUAL log entry present       → Phase 7 (expected/actual already known)
         ├─ Generic "System Error" + screenshot    → Phase 6 (visual analysis needed)
         └─ Anything else                          → Phase 4 (AI triage required)
Phase 4  (AI) Triage consolidated evidence
         ├─ Root cause found     → Phase 7
         ├─ Suspicious event     → Phase 6
         └─ Nothing significant  → Phase 5
Phase 5  find_previous_run  → prior sibling run for regression comparison
         ├─ Root cause now clear → Phase 7
         └─ Still inconclusive  → Phase 6
Phase 6  read_screenshot → AI visual analysis of the exception screenshot
         (skipped if consolidate_evidence already auto-inlined the image)
Phase 7  (AI) Final write-up — three sections for QEs:
         • What the evidence shows — screen, action, verbatim error message
         • AI Assessment — plain-English cause (product defect / data / environment)
         • AI Defect Classification — one label from a fixed taxonomy
Phase 8  generate_failure_report  → writes FailureAnalysisReport.md into the run folder
```

### Defect classification labels

`Click Failure` · `Connectivity Issue` · `Product Bug` · `System Error` · `Script Error` · `Pre-Req Error` · `Data Issue` · `Duplicate Data` · `Assertion Failure` · `Settings Issue` · `Keyword Issue` · `Pipeline Issue` · `Pipeline Timeout`

## MCP Tools

- **`extract_framework_keywords`** — keyword catalog with caching (mtime-based)
- **`parse_suite_results`** — failed test evidence from a run folder
- **`consolidate_evidence`** — phases 1+2 merged; main entry point for analysis
- **`find_previous_run`** — prior sibling run for regression diff
- **`read_screenshot`** — returns screenshot as image block for visual analysis
- **`generate_failure_report`** — writes the final Markdown report

## Requirements

- Node.js 18+
- WSL2 (paths translate between Windows `C:\...` and `/mnt/c/...` internally)
- Claude Code with MCP support
