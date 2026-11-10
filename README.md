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

| Phase | Type | Description |
|-------|------|-------------|
| 1 | Tool | `extract_framework_keywords` — scan C# source for `[Keyword]` methods |
| 2 | Tool | `parse_suite_results` — parse summary + per-test XMLs |
| 3 | Tool | `consolidate_evidence` — merge keyword + runtime data per failure |
| 4 | AI | Root-cause analysis over consolidated evidence |
| 5 | Tool | `find_previous_run` — locate prior run for regression comparison |
| 6 | AI | Visual screenshot analysis |
| 7 | AI | Final root-cause write-up (plain English for QEs) |
| 8 | Tool | `generate_failure_report` — write `FailureAnalysisReport.md` to disk |

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
