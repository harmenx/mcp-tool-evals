import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockChat } from "../examples/mock-openai/respond.js";
import { parseCompletion, type ModelClient } from "../src/model.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "mcp-tool-evals-"));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function scriptedModel(): ModelClient {
  return {
    async chat(request) {
      return parseCompletion(mockChat({ model: request.model, messages: request.messages, tools: request.tools }));
    },
  };
}

export function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.join(repoRoot, "src/cli.ts"), ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function startBookstoreHttp(): Promise<{ port: number; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, ["--import", "tsx", path.join(repoRoot, "examples/bookstore/server.ts"), "--http", "0"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = new Promise<number>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`bookstore did not listen\n${buf}`)), 10_000);
    child.stderr?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const match = buf.match(/listening (\d+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`bookstore exited ${code}: ${buf}`));
    });
  });
  return port.then((bound) => ({
    port: bound,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      }),
  }));
}
