import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { runEval } from "../src/runner.js";
import { repoRoot, scriptedModel } from "./helpers.js";

const configPath = path.join(repoRoot, "examples/bookstore/mcp-tool-evals.yaml");

describe("bookstore eval", () => {
  it("scores a correct model, a wrong-tool model, and a bad-arguments model", async () => {
    const config = await loadConfig(configPath, { ...process.env, OPENAI_API_KEY: "test" });
    config.models = [
      { name: "good", model: "mock-good" },
      { name: "wrong", model: "mock-wrong-tool" },
      { name: "bad", model: "mock-bad-args" },
    ];
    config.output = {};
    const report = await runEval(config, { client: scriptedModel() });

    expect(report.server.name).toBe("bookstore");
    expect(report.tools.map((tool) => tool.name)).toEqual(["search_books", "get_book", "list_by_tag", "calculate"]);

    const good = report.models.find((model) => model.name === "good");
    const wrong = report.models.find((model) => model.name === "wrong");
    const bad = report.models.find((model) => model.name === "bad");
    expect(good?.summary.successes).toBe(6);
    expect(good?.summary.rightToolRate).toBe(1);
    expect(good?.summary.validArgumentRate).toBe(1);
    expect(good?.summary.toolCalls).toBe(6);
    expect(good?.summary.totalTokens).toBeGreaterThan(0);

    expect(wrong?.summary.successes).toBe(0);
    expect(wrong?.summary.rightToolTasks).toBe(1);
    expect(wrong?.summary.rightToolEligible).toBe(6);

    expect(bad?.summary.successes).toBe(0);
    expect(bad?.summary.rightToolRate).toBe(1);
    expect(bad?.summary.validArgumentCalls).toBe(0);
    expect(bad?.summary.toolCalls).toBe(6);
  });
});
