import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../src/config.js";
import type { ModelClient } from "../src/model.js";
import { assessRightTool, scoreTask, summarize, taskCost } from "../src/score.js";
import type { EvalTask } from "../src/tasks.js";
import type { TaskRun } from "../src/types.js";

const model: ModelConfig = { name: "priced", model: "priced", inputPerMillion: 2, outputPerMillion: 8 };

const task: EvalTask = {
  id: "sum",
  prompt: "What is 2+2?",
  expect: { tools: ["calculate"], forbid: [], arguments: {} },
  verifier: { type: "exact", value: "4", caseSensitive: false },
};

function run(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    finalAnswer: "4",
    toolCalls: [
      {
        name: "calculate",
        arguments: { op: "add" },
        argumentsText: "{}",
        schemaValid: true,
        checksValid: true,
        valid: true,
        isError: false,
        resultPreview: "4",
      },
    ],
    promptTokens: 100,
    completionTokens: 10,
    latencyMs: 25,
    stoppedEarly: false,
    ...overrides,
  };
}

describe("scoring", () => {
  it("passes an exact answer and prices the call", async () => {
    const client: ModelClient = { chat: () => Promise.reject(new Error("judge should not run")) };
    const scored = await scoreTask({ task, run: run(), model, client, judgeModel: "judge", timeoutMs: 1000 });
    expect(scored.success).toBe(true);
    expect(scored.rightTool).toBe(true);
    expect(scored.costUsd).toBeCloseTo((100 * 2 + 10 * 8) / 1_000_000);
  });

  it("fails a regex miss and a stopped loop without calling the judge", async () => {
    const client: ModelClient = { chat: () => Promise.reject(new Error("judge should not run")) };
    const regexTask: EvalTask = { ...task, verifier: { type: "regex", pattern: "nope", flags: "" } };
    const missed = await scoreTask({ task: regexTask, run: run(), model, client, judgeModel: "judge", timeoutMs: 1000 });
    expect(missed.success).toBe(false);
    const stopped = await scoreTask({
      task,
      run: run({ stoppedEarly: true, finalAnswer: "" }),
      model,
      client,
      judgeModel: "judge",
      timeoutMs: 1000,
    });
    expect(stopped.success).toBe(false);
    expect(stopped.error).toMatch(/final answer/);
  });

  it("uses the judge response and ignores tasks that name no tools", () => {
    expect(assessRightTool(task, run().toolCalls)).toBe(true);
    expect(assessRightTool(task, [])).toBe(false);
    expect(assessRightTool({ ...task, expect: { tools: [], forbid: [], arguments: {} } }, [])).toBeNull();
    expect(taskCost(0, 0, { name: "free", model: "free" })).toBeNull();
  });

  it("summarizes rates and leaves cost blank when no model has a price", async () => {
    const client: ModelClient = {
      async chat() {
        return { content: '{"pass": false, "reason": "missing price"}', toolCalls: [], promptTokens: 5, completionTokens: 5 };
      },
    };
    const judged = await scoreTask({
      task: { ...task, verifier: { type: "llm-judge", criteria: 'include "4"' } },
      run: run({ finalAnswer: "no" }),
      model: { name: "plain", model: "plain" },
      client,
      judgeModel: "judge",
      timeoutMs: 1000,
    });
    expect(judged.success).toBe(false);
    expect(judged.verifier.detail).toBe("missing price");
    const summary = summarize([judged, { ...judged, id: "other", success: true, rightTool: null, toolCalls: [] }]);
    expect(summary.taskSuccessRate).toBe(0.5);
    expect(summary.rightToolRate).toBe(1);
    expect(summary.validArgumentRate).toBe(1);
    expect(summary.costUsd).toBeNull();
  });
});
