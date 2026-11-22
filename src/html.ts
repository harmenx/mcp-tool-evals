import type { EvalReport, ModelReport, TaskResult, ToolCallRecord } from "./types.js";

/** A single HTML file: summary per model, then a drill-down for every task. */
export function renderHtml(report: EvalReport): string {
  const toolNames = report.tools.map((tool) => tool.name).join(", ") || "none";
  const body = report.models.length === 0 ? `<p class="muted">No models were configured.</p>` : report.models.map(renderModel).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mcp-tool-evals · ${esc(report.server.name)}</title>
<style>
  :root {
    color-scheme: light;
    --ink: #1c1915;
    --muted: #5e584f;
    --line: #e4ddd2;
    --paper: #f7f4ee;
    --card: #fffdf9;
    --pass: #1f6b45;
    --pass-bg: #e7f4ec;
    --fail: #8d3418;
    --fail-bg: #fbece6;
    --accent: #1f4d6e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 15px/1.5 "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  }
  main { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.8rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 4px; }
  h2 { font-size: 1.25rem; font-weight: 600; margin: 0; }
  h3 { font-size: 1rem; margin: 0; font-weight: 600; }
  p { margin: 0.4em 0; }
  .sub { color: var(--muted); margin-bottom: 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 18px; color: var(--muted); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; margin-bottom: 28px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 18px 8px; margin: 0 0 22px; }
  table { width: 100%; border-collapse: collapse; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13.5px; margin: 8px 0 16px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; letter-spacing: 0.02em; }
  .num { font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; border-radius: 999px; padding: 0 8px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; line-height: 1.7; }
  .pass { color: var(--pass); background: var(--pass-bg); }
  .fail { color: var(--fail); background: var(--fail-bg); }
  .muted { color: var(--muted); }
  details { border-top: 1px solid var(--line); padding: 8px 0; }
  summary { cursor: pointer; font-family: ui-sans-serif, system-ui, sans-serif; }
  .prompt, pre { white-space: pre-wrap; word-break: break-word; background: var(--paper); border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; }
  .call { margin: 10px 0 14px; }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.92em; }
</style>
</head>
<body>
<main>
  <h1>mcp-tool-evals</h1>
  <p class="sub">${esc(report.server.name)} ${esc(report.server.version)}</p>
  <div class="meta">
    <span>${esc(report.server.transport)} <code>${esc(report.server.target)}</code></span>
    <span>Tools: ${esc(toolNames)}</span>
    <span>Started ${esc(report.startedAt)}</span>
  </div>
  ${overview(report)}
  ${body}
</main>
</body>
</html>
`;
}

function overview(report: EvalReport): string {
  if (report.models.length === 0) return "";
  const rows = report.models
    .map((model) => {
      const summary = model.summary;
      return `<tr>
        <td>${esc(model.name)}</td>
        <td><code>${esc(model.model)}</code></td>
        <td class="num">${model.error ? "—" : rate(summary.taskSuccessRate, summary.successes, summary.tasks)}</td>
        <td class="num">${model.error || summary.rightToolRate === null ? "—" : rate(summary.rightToolRate, summary.rightToolTasks, summary.rightToolEligible)}</td>
        <td class="num">${model.error || summary.validArgumentRate === null ? "—" : rate(summary.validArgumentRate, summary.validArgumentCalls, summary.toolCalls)}</td>
        <td class="num">${model.error ? "—" : String(summary.totalTokens)}</td>
        <td class="num">${model.error ? "—" : duration(summary.latencyMs)}</td>
        <td class="num">${model.error ? "—" : cost(summary.costUsd)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="card">
    <h2>Models</h2>
    <table>
      <thead><tr><th>Name</th><th>Model</th><th>Success</th><th>Right tool</th><th>Valid args</th><th>Tokens</th><th>Latency</th><th>Cost</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderModel(model: ModelReport): string {
  if (model.error) {
    return `<section class="card"><h2>${esc(model.name)}</h2><p class="fail">Connection failed: ${esc(model.error)}</p></section>`;
  }
  const rows = model.tasks.map(taskRow).join("");
  const empty = model.tasks.length === 0 ? `<tr><td colspan="8" class="muted">No tasks.</td></tr>` : "";
  return `<section class="card">
    <h2>${esc(model.name)}</h2>
    <p class="muted"><code>${esc(model.model)}</code></p>
    <table>
      <thead><tr><th>Task</th><th>Success</th><th>Right tool</th><th>Valid args</th><th>Calls</th><th>Tokens</th><th>Latency</th><th>Cost</th></tr></thead>
      <tbody>${rows}${empty}</tbody>
    </table>
    ${model.tasks.map(taskDetails).join("\n")}
  </section>`;
}

function taskRow(task: TaskResult): string {
  const valid = task.toolCalls.filter((call) => call.valid).length;
  const args = task.toolCalls.length === 0 ? "—" : `${valid}/${task.toolCalls.length}`;
  return `<tr>
    <td>${esc(task.id)}</td>
    <td>${badge(task.success)}</td>
    <td>${task.rightTool === null ? "—" : badge(task.rightTool)}</td>
    <td class="num">${args}</td>
    <td class="num">${task.toolCalls.length}</td>
    <td class="num">${task.promptTokens + task.completionTokens}</td>
    <td class="num">${duration(task.latencyMs)}</td>
    <td class="num">${cost(task.costUsd)}</td>
  </tr>`;
}

function taskDetails(task: TaskResult): string {
  const calls = task.toolCalls.length === 0 ? `<p class="muted">No tool calls.</p>` : task.toolCalls.map(renderCall).join("");
  return `<details${task.success ? "" : " open"}>
    <summary><span class="${task.success ? "pass" : "fail"}">${task.success ? "pass" : "fail"}</span> ${esc(task.id)}</summary>
    <h3>Prompt</h3>
    <div class="prompt">${esc(task.prompt)}</div>
    <h3>Answer</h3>
    <div class="prompt">${esc(task.finalAnswer || "(empty)")}</div>
    <p>Verifier <code>${esc(task.verifier.type)}</code>: ${esc(task.verifier.detail)}</p>
    ${task.error ? `<p class="fail">${esc(task.error)}</p>` : ""}
    <h3>Tool calls</h3>
    ${calls}
  </details>`;
}

function renderCall(call: ToolCallRecord): string {
  const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments, null, 2);
  return `<div class="call">
    <p><code>${esc(call.name)}</code> ${call.valid ? badge(true) : badge(false)} ${call.isError ? `<span class="badge fail">tool error</span>` : ""}</p>
    <pre>${esc(args)}</pre>
    <pre>${esc(call.resultPreview || "(empty)")}</pre>
  </div>`;
}

function badge(pass: boolean): string {
  return `<span class="badge ${pass ? "pass" : "fail"}">${pass ? "pass" : "fail"}</span>`;
}

function rate(value: number, hit: number, total: number): string {
  return `${percent(value)} (${hit}/${total})`;
}

function percent(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function cost(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
