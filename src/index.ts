import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { extractFrameworkKeywords } from "./tools/extractKeywords.js";
import { parseSuiteResults } from "./tools/parseSuiteResults.js";
import { consolidateEvidence } from "./tools/consolidateEvidence.js";
import { findPreviousRun } from "./tools/findPreviousRun.js";
import { generateFailureReport } from "./tools/generateReport.js";
import { readScreenshot } from "./tools/readScreenshot.js";

const server = new McpServer({
  name: "ifa-test-analysis",
  version: "0.1.0",
});

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "extract_framework_keywords",
  {
    title: "Extract Framework Keywords",
    description:
      "Phase 1: Scan the CostpointLib C# source tree for [Keyword]-attributed methods under [ControlType]/[Component]-attributed classes, returning each keyword's name, owner, parameter spec, and description. Results are cached by file mtime fingerprint.",
    inputSchema: {
      rootPath: z
        .string()
        .optional()
        .describe(
          "Windows path to the CostpointLib root (e.g. C:\\TFS\\QEAutomation\\Selenium\\BrowserFramework\\Code\\BrowserFramework\\CostpointLib). Defaults to the known Costpoint path."
        ),
      forceRefresh: z.boolean().optional().describe("Bypass the cache and re-scan all files."),
    },
  },
  async (args) => jsonResult(await extractFrameworkKeywords(args))
);

server.registerTool(
  "parse_suite_results",
  {
    title: "Parse Suite Results",
    description:
      "Phase 2: Parse a SuiteResults run folder's summary.dat and per-test XML files, returning suite totals and, for each failed test, the failing step detail (keyword, control, parameters, exception logmessages) and resolved screenshot path.",
    inputSchema: {
      suiteResultsPath: z
        .string()
        .describe("Windows path to the timestamped suite run folder, e.g. C:\\TFS\\...\\SuiteResults\\<Suite>\\<Timestamp>"),
    },
  },
  async (args) => jsonResult(await parseSuiteResults(args))
);

server.registerTool(
  "consolidate_evidence",
  {
    title: "Consolidate Evidence",
    description:
      "Phase 3: For every failed test in a suite run, merge the failing step's keyword definition (from Phase 1) with its runtime evidence (from Phase 2) plus N preceding steps for context, into one evidence bundle per failure. When any failure carries a generic 'System Error' log message, the screenshot is automatically inlined as an image block so no separate read_screenshot call is needed.",
    inputSchema: {
      suiteResultsPath: z.string().describe("Windows path to the timestamped suite run folder."),
      frameworkRootPath: z
        .string()
        .optional()
        .describe("Windows path to the CostpointLib root, if not the default."),
      contextStepCount: z
        .number()
        .int()
        .optional()
        .describe("Number of steps preceding the failure to include as context (default 5)."),
    },
  },
  async (args) => {
    const output = await consolidateEvidence(args);
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
      { type: "text", text: JSON.stringify(output, null, 2) },
    ];

    const D_VAR_RE = /D\{[^}]+\}/;

    for (const bundle of output.bundles) {
      const msgs = bundle.failingStep?.logmessages ?? [];
      const params = bundle.failingStep?.parameters ?? [];

      const isGenericSystemError = msgs.some(
        (m) => m.type === "EXCEPTIONMSG" && m.details.startsWith("System Error was encountered")
      );
      const isDocDiff = bundle.failingStep?.keyword === "DocDiff";

      // Auto-inline screenshot for generic system errors — visual inspection required.
      if (isGenericSystemError && bundle.screenshotPath) {
        try {
          const img = readScreenshot({ screenshotPath: bundle.screenshotPath });
          content.push({ type: "image", data: img.data, mimeType: img.mimeType });
        } catch {
          // screenshot missing or unreadable — AI will fall back to read_screenshot manually
        }
        continue;
      }

      // For non-phase-6, non-DocDiff bundles: if the failing step has at least one
      // meaningful resolved parameter (non-empty, no D{VarName} token), inline the
      // screenshot for reference only — no AI visual analysis. Skip silently on any error.
      if (
        !isDocDiff &&
        bundle.route.suggestedPhase !== 6 &&
        bundle.screenshotPath &&
        params.some((p) => p.trim() !== "" && !D_VAR_RE.test(p))
      ) {
        try {
          const img = readScreenshot({ screenshotPath: bundle.screenshotPath });
          content.push({ type: "image", data: img.data, mimeType: img.mimeType });
        } catch {
          // screenshot missing or unreadable — skip silently
        }
      }
    }

    return { content };
  }
);

server.registerTool(
  "find_previous_run",
  {
    title: "Find Previous Suite Run",
    description:
      "Phase 5: Given a suite run folder, locate the chronologically prior run folder for the same suite (sibling timestamped directory) and parse its summary, to support regression comparison ('was this failing last time too?').",
    inputSchema: {
      suiteResultsPath: z.string().describe("Windows path to the current timestamped suite run folder."),
    },
  },
  async (args) => jsonResult(await findPreviousRun(args))
);

server.registerTool(
  "generate_failure_report",
  {
    title: "Generate Failure Report",
    description:
      "Phase 8: Write a Markdown failure-analysis report into the suite run folder from AI-supplied root-cause findings (one per failed test): root cause, evidence bullets, screenshot reference, and recommendation.",
    inputSchema: {
      suiteResultsPath: z.string().describe("Windows path to the suite run folder to write the report into."),
      reportFileName: z.string().optional().describe("Report file name (default FailureAnalysisReport.md)."),
      findings: z
        .array(
          z.object({
            testName: z.string(),
            rootCause: z.string(),
            evidence: z.array(z.string()),
            screenshotPath: z.string().optional(),
            recommendation: z.string(),
          })
        )
        .describe("One finding per analyzed failure."),
    },
  },
  async (args) => jsonResult(await generateFailureReport(args))
);

server.registerTool(
  "read_screenshot",
  {
    title: "Read Screenshot",
    description:
      "Phase 6: Read a screenshot PNG/JPG from a suite run folder and return it as an image for visual analysis. Accepts the Windows path returned by consolidate_evidence's screenshotPath field.",
    inputSchema: {
      screenshotPath: z
        .string()
        .describe("Windows path to the screenshot file, e.g. C:\\TFS\\...\\SuiteResults\\<Suite>\\<Timestamp>\\EXCEPTIONIMG_*.png"),
    },
  },
  (args) => {
    const result = readScreenshot(args);
    return {
      content: [
        {
          type: "image" as const,
          data: result.data,
          mimeType: result.mimeType,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
