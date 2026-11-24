import { describe, expect, it } from "vitest";
import { renderHtml } from "../src/html.js";
import type { EvalReport } from "../src/types.js";

const report: EvalReport = {
  version: 1,
  startedAt: "2026-11-21T16:08:52.000Z",
  finishedAt: "2026-11-21T16:09:00.000Z",
  server: { name: "bookstore", version: "1.0.0", transport: "stdio", target: "node server.ts" },
  tools: [{ name: "search_books" }],
  models: [
    {
      name: "mock",
      model: "mock-good",
      summary: {
        tasks: 1,
        successes: 1,
        taskSuccessRate: 1,
        rightToolRate: 1,
        rightToolTasks: 1,
        rightToolEligible: 1,
        validArgumentRate: 1,
        validArgumentCalls: 1,
        toolCalls: 1,
        meanToolCalls: 1,
        promptTokens: 80,
        completionTokens: 20,
        totalTokens: 100,
        latencyMs: 40,
        meanLatencyMs: 40,
        costUsd: null,
      },
      tasks: [
        {
          id: "dune-price",
          prompt: "What is <script>alert(1)</script>?",
          success: false,
          rightTool: true,
          verifier: { type: "regex", pass: false, detail: "Pattern missed." },
          toolCalls: [
            {
              name: "search_books",
              arguments: { query: "Dune" },
              argumentsText: "{\"query\":\"Dune\"}",
              schemaValid: true,
              checksValid: true,
              valid: true,
              isError: false,
              resultPreview: "Dune",
            },
          ],
          promptTokens: 80,
          completionTokens: 20,
          latencyMs: 40,
          costUsd: null,
          finalAnswer: "nope",
        },
      ],
    },
  ],
};

describe("renderHtml", () => {
  it("is a single document with a model summary and a task drill-down", () => {
    const html = renderHtml(report);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("<style>");
    expect(html).toContain("100% (1/1)");
    expect(html).toContain("dune-price");
    expect(html).toContain("search_books");
    expect(html).toContain("<details open>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
