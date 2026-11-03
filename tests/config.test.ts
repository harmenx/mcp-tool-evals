import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { UserError } from "../src/errors.js";

async function writeConfig(yaml: string, tasks = "tasks: []\n"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-config-"));
  await writeFile(path.join(dir, "tasks.yaml"), tasks);
  const file = path.join(dir, "mcp-tool-evals.yaml");
  await writeFile(file, yaml);
  return file;
}

const base = `
server:
  transport: stdio
  command: node
  args: ["server.js"]
provider:
  baseUrl: \${OPENAI_BASE_URL:-http://127.0.0.1:8787/v1}
  apiKeyEnv: OPENAI_API_KEY
models:
  - name: mock
    model: mock-good
tasks: tasks.yaml
`;

describe("loadConfig", () => {
  it("interpolates the provider URL and resolves paths from the config directory", async () => {
    const file = await writeConfig(base);
    const config = await loadConfig(file, { ...process.env, OPENAI_BASE_URL: "http://127.0.0.1:9/v1" });
    expect(config.provider.baseUrl).toBe("http://127.0.0.1:9/v1");
    expect(config.server).toMatchObject({ transport: "stdio", cwd: path.dirname(file), args: ["server.js"] });
    expect(config.tasksMissing).toBe(false);
    expect(config.limits).toEqual({ maxTurns: 4, timeoutMs: 60_000 });
  });

  it("uses the fallback when the environment variable is unset", async () => {
    const file = await writeConfig(base);
    const env = { ...process.env };
    delete env.OPENAI_BASE_URL;
    const config = await loadConfig(file, env);
    expect(config.provider.baseUrl).toBe("http://127.0.0.1:8787/v1");
  });

  it("reports a missing tasks file instead of failing the load", async () => {
    const file = await writeConfig(base.replace("tasks: tasks.yaml", "tasks: missing.yaml"));
    const config = await loadConfig(file, process.env);
    expect(config.tasksMissing).toBe(true);
    expect(config.tasks).toEqual([]);
  });

  it("rejects an unknown transport", async () => {
    const file = await writeConfig(base.replace("transport: stdio", "transport: websocket"));
    await expect(loadConfig(file, process.env)).rejects.toThrow(UserError);
  });
});
