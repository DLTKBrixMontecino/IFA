import { existsSync, readFileSync } from "node:fs";
import { toWslPath } from "../lib/pathTranslate.js";

export interface ReadScreenshotInput {
  screenshotPath: string;
}

export interface ReadScreenshotOutput {
  screenshotPath: string;
  mimeType: string;
  data: string; // base64
}

export function readScreenshot(input: ReadScreenshotInput): ReadScreenshotOutput {
  const wslPath = toWslPath(input.screenshotPath);
  if (!existsSync(wslPath)) {
    throw new Error(`Screenshot not found: ${input.screenshotPath} (resolved to ${wslPath})`);
  }
  const buf = readFileSync(wslPath);
  const lower = wslPath.toLowerCase();
  const mimeType = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return {
    screenshotPath: input.screenshotPath,
    mimeType,
    data: buf.toString("base64"),
  };
}
