import { writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";
import { isRecord } from "./util.js";

const CONFIG = `# mcp-tool-evals configuration.
# Paths are relative to this file. \${VAR} and \${VAR:-fallback} read the environment.

server:
  transport: stdio
  command: node
  args: ["--import", "tsx", "server.ts"]
  # transport: http
  # url: http://127.0.0.1:3000/mcp
  # headers:
  #   Authorization: Bearer \${MCP_TOKEN}

provider:
  # One OpenAI-compatible endpoint for every model. A LiteLLM proxy is a
  # common way to put Claude, GPT, Grok, and open models behind one URL.
  baseUrl: \${OPENAI_BASE_URL:-https://api.openai.com/v1}
  apiKeyEnv: OPENAI_API_KEY

models:
  - name: primary
    model: gpt-4.1
    # USD per million tokens. Set both to record cost; omit both to leave it blank.
    # inputPerMillion: 2
    # outputPerMillion: 8

tasks: tasks.yaml

limits:
  maxTurns: 4
  timeoutMs: 60000

# Model used by llm-judge verifiers. Defaults to the model under test.
# judge:
#   model: gpt-4.1

output:
  json: results.json
  markdown: summary.md
  html: report.html
`;

export async function scaffoldConfig(dir: string, force: boolean): Promise<string> {
  const configPath = path.join(dir, "mcp-tool-evals.yaml");
  try {
    await writeFile(configPath, CONFIG, { encoding: "utf8", flag: force ? "w" : "wx" });
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      throw new UserError(`${configPath} already exists. Pass --force to overwrite it.`);
    }
    throw error;
  }
  return configPath;
}
