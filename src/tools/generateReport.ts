import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { toWindowsPath, toWslPath } from "../lib/pathTranslate.js";

export interface FailureFinding {
  testName: string;
  rootCause: string;
  evidence: string[];
  screenshotPath?: string;
  recommendation: string;
}

export interface GenerateReportInput {
  suiteResultsPath: string;
  findings: FailureFinding[];
  reportFileName?: string;
}

export interface GenerateReportOutput {
  reportPath: string;
}

function renderFinding(f: FailureFinding): string {
  const evidenceList = f.evidence.map((e) => `- ${e}`).join("\n");
  const screenshotLine = f.screenshotPath ? `\n**Screenshot:** \`${f.screenshotPath}\`\n` : "";
  return `## ${f.testName}

**Root Cause:** ${f.rootCause}

**Evidence:**
${evidenceList}
${screenshotLine}
**Recommendation:** ${f.recommendation}
`;
}

export async function generateFailureReport(
  input: GenerateReportInput
): Promise<GenerateReportOutput> {
  const runFolder = toWslPath(input.suiteResultsPath);
  const fileName = input.reportFileName ?? "FailureAnalysisReport.md";
  const reportPathWsl = join(runFolder, fileName);

  const header = `# Failure Analysis Report

**Suite Results:** \`${input.suiteResultsPath}\`
**Generated:** ${new Date().toISOString()}
**Failures Analyzed:** ${input.findings.length}

---
`;

  const body = input.findings.map(renderFinding).join("\n---\n\n");
  writeFileSync(reportPathWsl, `${header}\n${body}\n`, "utf-8");

  return { reportPath: toWindowsPath(reportPathWsl) };
}
