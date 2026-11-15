import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-openai/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mock = await startMockServer(0);

const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(root, "src/cli.ts"), "run", "-c", "examples/bookstore/mcp-tool-evals.yaml"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      OPENAI_BASE_URL: mock.url,
      OPENAI_API_KEY: "demo",
    },
  },
);

const code = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (status) => resolve(status ?? 1));
});

await mock.close();
process.exitCode = code;
