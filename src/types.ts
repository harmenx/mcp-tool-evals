import type { EvalTask, Verifier } from "./tasks.js";

export interface ToolCallRecord {
  name: string;
  arguments: unknown;
  argumentsText: string;
  schemaValid: boolean;
  checksValid: boolean;
  valid: boolean;
  isError: boolean;
  resultPreview: string;
}

export interface TaskRun {
  finalAnswer: string;
  toolCalls: ToolCallRecord[];
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  stoppedEarly: boolean;
}

export interface VerifierResult {
  type: Verifier["type"];
  pass: boolean;
  detail: string;
}

export interface TaskResult {
  id: string;
  prompt: string;
  success: boolean;
  rightTool: boolean | null;
  verifier: VerifierResult;
  toolCalls: ToolCallRecord[];
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number | null;
  finalAnswer: string;
  error?: string;
}

export interface ModelSummary {
  tasks: number;
  successes: number;
  taskSuccessRate: number;
  rightToolRate: number | null;
  rightToolTasks: number;
  rightToolEligible: number;
  validArgumentRate: number | null;
  validArgumentCalls: number;
  toolCalls: number;
  meanToolCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  meanLatencyMs: number;
  costUsd: number | null;
}

export interface ModelReport {
  name: string;
  model: string;
  summary: ModelSummary;
  tasks: TaskResult[];
  error?: string;
}

export interface EvalReport {
  version: 1;
  startedAt: string;
  finishedAt: string;
  server: {
    name: string;
    version: string;
    transport: "stdio" | "http";
    target: string;
  };
  tools: Array<{ name: string; description?: string }>;
  models: ModelReport[];
}

export type { EvalTask };
