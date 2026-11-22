import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { listBenchmarks, runBenchmarks } from "../benchmark/run.js";

const expected = [
  "context7",
  "everything",
  "fetch",
  "filesystem",
  "git",
  "github",
  "memory",
  "playwright",
  "sequential-thinking",
  "time",
];

describe("benchmarks", () => {
  it("loads a task set for each public server", async () => {
    const names = await listBenchmarks();
    expect(names).toEqual(expected);
    const env = { ...process.env };
    delete env.OPENAI_BASE_URL;
    delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
    for (const name of names) {
      const config = await loadConfig(path.join("benchmark", name, "mcp-tool-evals.yaml"), env);
      expect(config.tasks.length).toBeGreaterThan(0);
      expect(config.tasksMissing).toBe(false);
    }
  });

  it("prints the plan without connecting", async () => {
    let text = "";
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      text += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await runBenchmarks({ dryRun: true, only: "time" });
      expect(code).toBe(0);
    } finally {
      process.stdout.write = write;
    }
    expect(text).toContain("time");
    expect(text).toContain("uvx mcp-server-time");
  });
});
