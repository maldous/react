# platform-governor MCP server

A **local, credential-free, read-mostly** MCP server that exposes this repo's native governance tools to
Claude Code. It is wired into the committed `.mcp.json` at the repo root and starts automatically when
Claude Code opens this project.

## Why

The repo has a deep deterministic governance toolchain (orchestrator, action-register validator, proof
scripts, capability map). This server lets Claude query and run those tools through MCP instead of
guessing or re-implementing them — improving ADR compliance, architecture analysis, and evidence work.

## Tools

| Tool                            | What it does                                                                                              | Side effects                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `list_adrs`                     | List all ADRs with id/title/status                                                                        | read-only                              |
| `get_action_status`             | Query ACTION-REGISTER rows by id/status + status counts                                                   | read-only                              |
| `validate_action_register`      | Run the action-register validator                                                                         | runs repo script                       |
| `run_architecture_gates`        | Run the orchestrator (`validate`/`all`/`validate-evidence`/`generate-inventory`, `--no-reports --strict`) | runs repo script                       |
| `list_evidence`                 | List `docs/evidence` files (optionally by area)                                                           | read-only                              |
| `map_capabilities`              | Return the enterprise capability matrix                                                                   | read-only                              |
| `map_contracts_routes_usecases` | Map contract packages + platform-api route/usecase files                                                  | read-only                              |
| `run_proof_script`              | Run an allowlisted live proof (`proof:auth-*`)                                                            | runs repo script; needs local services |

## Security model

- **Local only, no network, no secrets.** Nothing is sent anywhere; no credentials are read or stored.
- **No shell injection.** Every child process uses a fixed argv array; tool inputs are validated against
  allowlists/enums and never interpolated into a shell.
- **Read-mostly.** The only "writes" are running existing repo scripts exactly as the operator would.
  `run_proof_script` is restricted to the three `proof:auth-*` scripts; `run_architecture_gates` to four
  orchestrator commands.
- It exposes no tool that edits files, hits production, or touches a live tenant.

## Run / test

```bash
npm run mcp:governor            # start the server (stdio)
npm run mcp:governor:selftest   # handshake + tool self-test (exits non-zero on failure)
```

Repo root is taken from `CONTROL_REPO_ROOT` if set, otherwise the process working directory (which is the
project root when launched by Claude Code).
