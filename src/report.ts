import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalReport, ModelReport, TaskResult } from "./types.js";

export function renderMarkdown(report: EvalReport): string {
  const toolNames = report.tools.map((tool) => tool.name).join(", ") || "(none)";
  const lines = [
    "# mcp-tool-evals",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Server | ${cell(`${report.server.name} ${report.server.version}`.trim())} |`,
    `| Transport | ${cell(report.server.transport)} \`${cell(report.server.target)}\` |`,
    `| Tools | ${cell(toolNames)} |`,
    `| Started | ${report.startedAt} |`,
    "",
  ];

  if (report.models.length === 0) {
    lines.push("No models were configured.", "");
    return lines.join("\n");
  }

  for (const model of report.models) {
    lines.push(...renderModel(model), "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

export async function writeReport(report: EvalReport, output: { json?: string; markdown?: string }): Promise<string[]> {
  const written: string[] = [];
  if (output.json) {
    await writeText(output.json, `${JSON.stringify(report, null, 2)}\n`);
    written.push(output.json);
  }
  if (output.markdown) {
    await writeText(output.markdown, renderMarkdown(report));
    written.push(output.markdown);
  }
  return written;
}

function renderModel(model: ModelReport): string[] {
  const lines = [`## ${model.name}`, "", `Model \`${model.model}\`.`, ""];
  if (model.error) {
    lines.push(`Connection failed: ${model.error}`, "");
    return lines;
  }
  lines.push(
    "| Task | Success | Right tool | Valid args | Tool calls | Tokens | Latency | Cost |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const task of model.tasks) lines.push(renderTaskRow(task));
  if (model.tasks.length === 0) lines.push("| (none) | — | — | — | 0 | 0 | — | — |");
  const summary = model.summary;
  lines.push(
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Task success | ${formatRate(summary.taskSuccessRate, summary.successes, summary.tasks)} |`,
    `| Right-tool rate | ${summary.rightToolRate === null ? "—" : formatRate(summary.rightToolRate, summary.rightToolTasks, summary.rightToolEligible)} |`,
    `| Valid-argument rate | ${summary.validArgumentRate === null ? "—" : formatRate(summary.validArgumentRate, summary.validArgumentCalls, summary.toolCalls)} |`,
    `| Tool calls | ${summary.toolCalls} (mean ${formatMean(summary.meanToolCalls)}) |`,
    `| Tokens | ${summary.totalTokens} (prompt ${summary.promptTokens}, completion ${summary.completionTokens}) |`,
    `| Latency | ${formatDuration(summary.latencyMs)} (mean ${formatDuration(summary.meanLatencyMs)}) |`,
    `| Cost | ${formatCost(summary.costUsd)} |`,
  );
  const failures = model.tasks.filter((task) => !task.success);
  lines.push("", "### Failures", "");
  if (failures.length === 0) {
    lines.push("None.");
  } else {
    for (const task of failures) {
      const called = task.toolCalls.map((call) => call.name).join(", ") || "no tools";
      lines.push(`- **${task.id}** — ${task.verifier.detail} Called ${called}.`);
    }
  }
  return lines;
}

function renderTaskRow(task: TaskResult): string {
  const valid = task.toolCalls.filter((call) => call.valid).length;
  const args = task.toolCalls.length === 0 ? "—" : `${valid}/${task.toolCalls.length}`;
  const tokens = task.promptTokens + task.completionTokens;
  return `| ${cell(task.id)} | ${task.success ? "pass" : "fail"} | ${formatFlag(task.rightTool)} | ${args} | ${task.toolCalls.length} | ${tokens} | ${formatDuration(task.latencyMs)} | ${formatCost(task.costUsd)} |`;
}

function formatFlag(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "pass" : "fail";
}

function formatRate(rate: number, hit: number, total: number): string {
  return `${formatPercent(rate)} (${hit}/${total})`;
}

function formatPercent(rate: number): string {
  const percent = rate * 100;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function formatMean(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "—";
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}
