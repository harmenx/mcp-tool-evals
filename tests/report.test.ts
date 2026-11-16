import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, renderMarkdown } from "../src/report.js";
import type { EvalReport } from "../src/types.js";

const report: EvalReport = {
  version: 1,
  startedAt: "2026-11-22T00:00:00.000Z",
  finishedAt: "2026-11-22T00:00:01.000Z",
  server: { name: "bookstore", version: "1.0.0", transport: "stdio", target: "node server.ts" },
  tools: [{ name: "search_books" }, { name: "calculate" }],
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
          prompt: "What is the price of Dune?",
          success: true,
          rightTool: true,
          verifier: { type: "regex", pass: true, detail: "Pattern matched." },
          toolCalls: [
            {
              name: "search_books",
              arguments: { query: "Dune" },
              argumentsText: '{"query":"Dune"}',
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
          finalAnswer: "Dune is $9.99",
        },
      ],
    },
  ],
};

describe("renderMarkdown", () => {
  it("writes one task table and one metric table per model", () => {
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("| Task | Success | Right tool | Valid args | Tool calls | Tokens | Latency | Cost |");
    expect(markdown).toContain("| dune-price | pass | pass | 1/1 | 1 | 100 | 40ms | — |");
    expect(markdown).toContain("| Task success | 100% (1/1) |");
    expect(markdown).toContain("| Cost | — |");
    expect(markdown).toContain("### Failures");
    expect(markdown).toContain("None.");
  });

  it("formats duration and cost", () => {
    expect(formatDuration(12)).toBe("12ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatCost(null)).toBe("—");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.000012)).toBe("$0.000012");
    expect(formatCost(1.23456)).toBe("$1.2346");
  });
});
