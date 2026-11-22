import { readFile } from "node:fs/promises";
import { UserError } from "./errors.js";
import { isRecord } from "./util.js";

export interface SuccessRate {
  name: string;
  taskSuccessRate: number;
  tasks?: number;
  successes?: number;
}

export interface Regression {
  name: string;
  baselineRate: number;
  currentRate: number;
  drop: number;
}

/** Positive drop means the current run is worse than the baseline. */
export function findRegressions(current: SuccessRate[], baseline: SuccessRate[], threshold: number): Regression[] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new UserError("Threshold must be a number from 0 to 1. 0.05 means five percentage points.");
  }
  const currentByName = new Map(current.map((model) => [model.name, model]));
  const regressions: Regression[] = [];
  for (const previous of baseline) {
    const next = currentByName.get(previous.name);
    const currentRate = next?.taskSuccessRate ?? 0;
    const drop = previous.taskSuccessRate - currentRate;
    if (drop > threshold + 1e-9) {
      regressions.push({
        name: previous.name,
        baselineRate: previous.taskSuccessRate,
        currentRate,
        drop,
      });
    }
  }
  return regressions;
}

export function readSuccessRates(document: unknown): SuccessRate[] {
  if (!isRecord(document) || !Array.isArray(document.models)) {
    throw new UserError("A results file must be an object with a models list.");
  }
  const seen = new Set<string>();
  return document.models.map((model, index) => {
    if (!isRecord(model)) throw new UserError(`models[${index}] must be an object.`);
    if (typeof model.name !== "string" || model.name.trim() === "") {
      throw new UserError(`models[${index}].name must be a string.`);
    }
    if (seen.has(model.name)) throw new UserError(`models[${index}].name "${model.name}" is duplicated.`);
    seen.add(model.name);
    return { name: model.name, ...rateFields(model, `models[${index}]`) };
  });
}

export async function readSuccessRatesFile(file: string): Promise<SuccessRate[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") throw new UserError(`File not found: ${file}`);
    throw error;
  }
  try {
    return readSuccessRates(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`Could not parse ${file} as JSON.`);
  }
}

export function renderDiff(current: SuccessRate[], baseline: SuccessRate[], threshold: number): string {
  const regressions = findRegressions(current, baseline, threshold);
  const failed = new Set(regressions.map((item) => item.name));
  const currentByName = new Map(current.map((model) => [model.name, model]));
  const lines = [
    "## Baseline",
    "",
    `Threshold: ${(threshold * 100).toFixed(1).replace(/\.0$/, "")} percentage points.`,
    "",
    "| Model | Baseline | Current | Drop |",
    "| --- | --- | --- | --- |",
  ];
  for (const previous of baseline) {
    const next = currentByName.get(previous.name);
    const currentRate = next?.taskSuccessRate ?? 0;
    const drop = previous.taskSuccessRate - currentRate;
    const mark = failed.has(previous.name) ? "fail" : "ok";
    lines.push(`| ${previous.name} | ${pct(previous.taskSuccessRate)} | ${pct(currentRate)} | ${pct(drop)} (${mark}) |`);
  }
  lines.push("");
  if (regressions.length === 0) lines.push("No model dropped by more than the threshold.");
  else lines.push(`${regressions.length} model${regressions.length === 1 ? "" : "s"} dropped by more than the threshold.`);
  lines.push("");
  return lines.join("\n");
}

function rateFields(model: Record<string, unknown>, label: string): Omit<SuccessRate, "name"> {
  const summary = isRecord(model.summary) ? model.summary : undefined;
  const raw = summary && "taskSuccessRate" in summary ? summary.taskSuccessRate : model.taskSuccessRate;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new UserError(`${label}.taskSuccessRate must be a number from 0 to 1.`);
  }
  const tasks = summary && typeof summary.tasks === "number" ? summary.tasks : undefined;
  const successes = summary && typeof summary.successes === "number" ? summary.successes : undefined;
  return { taskSuccessRate: raw, tasks, successes };
}

function pct(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
