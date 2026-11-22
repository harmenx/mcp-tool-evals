# Benchmark

Task sets for ten public MCP servers. Each directory is a normal `mcp-tool-evals` config: a launch line and a few tasks. Nothing here is a published score. The checked-in model is the local mock, so a run against it only checks that the harness can start. Numbers from that run are not a comparison of real models.

## Servers

| Directory | Server | Launch |
| --- | --- | --- |
| `filesystem` | `@modelcontextprotocol/server-filesystem` | `npx` |
| `memory` | `@modelcontextprotocol/server-memory` | `npx` |
| `everything` | `@modelcontextprotocol/server-everything` | `npx` |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | `npx` |
| `fetch` | `mcp-server-fetch` | `uvx` |
| `git` | `mcp-server-git` | `uvx`, confined to this repo |
| `time` | `mcp-server-time` | `uvx` |
| `playwright` | `@playwright/mcp` | `npx` |
| `context7` | `@upstash/context7-mcp` | `npx` |
| `github` | `ghcr.io/github/github-mcp-server` | `docker`, needs `GITHUB_PERSONAL_ACCESS_TOKEN` |

`fetch`, `git`, and `time` are the Python reference servers and need [uv](https://docs.astral.sh/uv/). The others are Node packages, except GitHub, which is the official container and needs a token. Filesystem and git are pointed at the repo root. Git tasks are read-only.

## Run

List what would run, without starting servers or calling a model:

```bash
npm run benchmark -- --dry-run
```

Against the mock model (no API key, and the results are not worth publishing):

```bash
node --import tsx examples/mock-openai/server.ts &
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=demo
npm run benchmark -- --allow-failures
```

One server:

```bash
npm run benchmark -- --only time
```

Reports land in `benchmark/results/<server>/` as JSON, Markdown, and HTML. That directory is gitignored.

To measure real models, point `OPENAI_BASE_URL` at your proxy and change `models` in the config you care about. Keep the task file. Do not commit the results unless you ran them.
