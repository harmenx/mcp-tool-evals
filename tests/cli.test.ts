import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startMockServer, type MockServer } from "../examples/mock-openai/server.js";
import { parseTasks } from "../src/tasks.js";
import { removeDir, repoRoot, runCli, tempDir } from "./helpers.js";

let mock: MockServer;

beforeAll(async () => {
  mock = await startMockServer(0);
});

afterAll(async () => {
  await mock.close();
});

const env = () => ({ OPENAI_BASE_URL: mock.url, OPENAI_API_KEY: "test" });

describe("cli", () => {
  it("runs the example config against the mock model", async () => {
    const dir = await tempDir();
    try {
      const result = await runCli(
        ["run", "-c", "examples/bookstore/mcp-tool-evals.yaml", "--json", path.join(dir, "results.json"), "--markdown", path.join(dir, "summary.md")],
        env(),
      );
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("| dune-price | pass |");
      expect(result.stdout).toContain("| Task success | 100% (6/6) |");
      expect(result.stderr).toContain("pass  mock  dune-price");
      const saved = JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as { models: Array<{ summary: { successes: number } }> };
      expect(saved.models[0]?.summary.successes).toBe(6);
      expect(await readFile(path.join(dir, "summary.md"), "utf8")).toContain("## mock");
    } finally {
      await removeDir(dir);
    }
  });

  it("exits 1 when a task fails and 0 when failures are allowed", async () => {
    const dir = await tempDir();
    const config = path.join(dir, "mcp-tool-evals.yaml");
    const server = path.join(repoRoot, "examples/bookstore/server.ts");
    const tasks = path.join(repoRoot, "examples/bookstore/tasks.yaml");
    await writeFile(
      config,
      [
        "server:",
        "  transport: stdio",
        "  command: node",
        `  args: ["--import", "tsx", ${JSON.stringify(server)}]`,
        `  cwd: ${JSON.stringify(repoRoot)}`,
        "provider:",
        `  baseUrl: ${mock.url}`,
        "  apiKeyEnv: OPENAI_API_KEY",
        "models:",
        "  - name: wrong",
        "    model: mock-wrong-tool",
        `tasks: ${JSON.stringify(tasks)}`,
        "judge:",
        "  model: mock-good",
        "",
      ].join("\n"),
    );
    try {
      const failed = await runCli(["run", "-c", config], env());
      expect(failed.code, failed.stderr).toBe(1);
      expect(failed.stdout).toContain("| Task success | 0% (0/6) |");
      const allowed = await runCli(["run", "-c", config, "--allow-failures"], env());
      expect(allowed.code, allowed.stderr).toBe(0);
    } finally {
      await removeDir(dir);
    }
  });

  it("lists tools and drafts tasks without a real model key", async () => {
    const listed = await runCli(["tools", "-c", "examples/bookstore/mcp-tool-evals.yaml"], env());
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toContain("search_books");
    expect(listed.stdout).toContain("query: string");

    const dir = await mkdtemp(path.join(tmpdir(), "mcp-draft-"));
    const out = path.join(dir, "draft.yaml");
    const generated = await runCli(
      ["generate", "-c", "examples/bookstore/mcp-tool-evals.yaml", "-o", out, "-n", "2"],
      env(),
    );
    expect(generated.code, generated.stderr).toBe(0);
    const tasks = parseTasks(parse(await readFile(out, "utf8")));
    expect(tasks.map((task) => task.id)).toEqual(["draft-search_books", "draft-get_book"]);
    await removeDir(dir);
  });

  it("writes a starter config", async () => {
    const dir = await tempDir();
    try {
      const result = await runCli(["init", "-d", dir]);
      expect(result.code, result.stderr).toBe(0);
      const text = await readFile(path.join(dir, "mcp-tool-evals.yaml"), "utf8");
      expect(text).toContain("apiKeyEnv: OPENAI_API_KEY");
      const again = await runCli(["init", "-d", dir]);
      expect(again.code).toBe(2);
    } finally {
      await removeDir(dir);
    }
  });
});
