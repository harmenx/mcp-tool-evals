import type { ModelConfig } from "./config.js";
import type { ModelClient } from "./model.js";
import type { EvalTask } from "./tasks.js";
import type { ModelSummary, TaskResult, TaskRun, ToolCallRecord, VerifierResult } from "./types.js";
import { isRecord } from "./util.js";

const JUDGE_SYSTEM =
  'Grade the answer. Reply with JSON only, no markdown: {"pass": true or false, "reason": "short explanation"}.';

export async function scoreTask(input: {
  task: EvalTask;
  run: TaskRun;
  model: ModelConfig;
  client: ModelClient;
  judgeModel: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TaskResult> {
  const rightTool = assessRightTool(input.task, input.run.toolCalls);
  const costUsd = taskCost(input.run.promptTokens, input.run.completionTokens, input.model);
  const base = {
    id: input.task.id,
    prompt: input.task.prompt,
    rightTool,
    toolCalls: input.run.toolCalls,
    promptTokens: input.run.promptTokens,
    completionTokens: input.run.completionTokens,
    latencyMs: input.run.latencyMs,
    costUsd,
    finalAnswer: input.run.finalAnswer,
  };

  if (input.run.stoppedEarly) {
    const detail = "The model stopped before giving a final answer.";
    return { ...base, success: false, error: detail, verifier: { type: input.task.verifier.type, pass: false, detail } };
  }

  const verifier = await verify(input);
  return { ...base, success: verifier.pass, verifier };
}

export function assessRightTool(task: EvalTask, calls: ToolCallRecord[]): boolean | null {
  const { tools, forbid } = task.expect;
  if (tools.length === 0 && forbid.length === 0) return null;
  const called = new Set(calls.map((call) => call.name));
  return tools.every((name) => called.has(name)) && forbid.every((name) => !called.has(name));
}

export function taskCost(promptTokens: number, completionTokens: number, model: ModelConfig): number | null {
  if (model.inputPerMillion === undefined && model.outputPerMillion === undefined) return null;
  const input = model.inputPerMillion ?? 0;
  const output = model.outputPerMillion ?? 0;
  return (promptTokens * input + completionTokens * output) / 1_000_000;
}

export function summarize(tasks: TaskResult[]): ModelSummary {
  const successes = tasks.filter((task) => task.success).length;
  const eligible = tasks.filter((task) => task.rightTool !== null);
  const rightToolTasks = eligible.filter((task) => task.rightTool).length;
  const toolCalls = tasks.reduce((sum, task) => sum + task.toolCalls.length, 0);
  const validArgumentCalls = tasks.reduce((sum, task) => sum + task.toolCalls.filter((call) => call.valid).length, 0);
  const promptTokens = tasks.reduce((sum, task) => sum + task.promptTokens, 0);
  const completionTokens = tasks.reduce((sum, task) => sum + task.completionTokens, 0);
  const latencyMs = tasks.reduce((sum, task) => sum + task.latencyMs, 0);
  const costs = tasks.map((task) => task.costUsd);
  return {
    tasks: tasks.length,
    successes,
    taskSuccessRate: tasks.length === 0 ? 0 : successes / tasks.length,
    rightToolRate: eligible.length === 0 ? null : rightToolTasks / eligible.length,
    rightToolTasks,
    rightToolEligible: eligible.length,
    validArgumentRate: toolCalls === 0 ? null : validArgumentCalls / toolCalls,
    validArgumentCalls,
    toolCalls,
    meanToolCalls: tasks.length === 0 ? 0 : toolCalls / tasks.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs,
    meanLatencyMs: tasks.length === 0 ? 0 : latencyMs / tasks.length,
    costUsd: costs.every((cost) => cost === null) ? null : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
  };
}

async function verify(input: {
  task: EvalTask;
  run: TaskRun;
  client: ModelClient;
  judgeModel: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<VerifierResult> {
  const answer = input.run.finalAnswer;
  const verifier = input.task.verifier;
  if (verifier.type === "exact") {
    const pass = normalize(answer, verifier.caseSensitive) === normalize(verifier.value, verifier.caseSensitive);
    return {
      type: "exact",
      pass,
      detail: pass ? "Exact match." : `Expected ${JSON.stringify(verifier.value)}.`,
    };
  }
  if (verifier.type === "regex") {
    const pass = new RegExp(verifier.pattern, verifier.flags).test(answer);
    return {
      type: "regex",
      pass,
      detail: pass ? "Pattern matched." : `Pattern /${verifier.pattern}/${verifier.flags} did not match.`,
    };
  }
  const response = await input.client.chat({
    model: verifier.model ?? input.judgeModel,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: `Criteria:\n${verifier.criteria}\n\nAnswer:\n${answer}` },
    ],
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]) : AbortSignal.timeout(input.timeoutMs),
  });
  const judged = parseJudge(response.content);
  return { type: "llm-judge", pass: judged.pass, detail: judged.reason || (judged.pass ? "Pass." : "Fail.") };
}

function parseJudge(text: string): { pass: boolean; reason: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (match?.[0]) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (isRecord(parsed) && typeof parsed.pass === "boolean") {
        return { pass: parsed.pass, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
      }
    } catch {
      // The judge text is kept as the failure reason below.
    }
  }
  return { pass: false, reason: text.trim() || "The judge did not return JSON." };
}

function normalize(text: string, caseSensitive: boolean): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}
