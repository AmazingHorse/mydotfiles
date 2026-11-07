# Plan: `friend-programmer` Tool Multiplexer & `omp` High-SNR Integration (`part13`)

> **Status:** Future Architecture & Integration Contract (executes after `friend-programmer` repo refactor)  
> **Scope:** `dot_omp/private_agent/mcp.json`, `dot_omp/archetypes/agent-cli.md`, and the external `friend-programmer` repository  
> **Goal:** Route external MCP servers through `friend-programmer` as a single high-SNR (Signal-to-Noise Ratio) tool multiplexer that complements—and never duplicates—`omp`'s built-in tools, internal URI schemes, and `xd://` devices.

---

## 1. Architectural Principle: Maximize Tool SNR & Avoid Shadowing `omp`

Every MCP tool schema registered directly in `~/.omp/agent/mcp.json` (or `.claude/mcp.json`) pays a **per-turn token tax** in the system prompt and degrades model tool-selection accuracy when tool counts exceed ~20–30 tools.

Furthermore, `omp` already ships native, zero-overhead implementations of many capabilities that other harnesses need MCPs for. Therefore, `friend-programmer` must enforce a strict **Non-Duplication Boundary**:

### 1.1 What `omp` Handles Natively (NEVER Expose via `friend-programmer` to `omp`)

| Capability | `omp` Built-in Primitive | Why `friend-programmer` Should Suppress Equivalent MCPs in `omp` |
| :--- | :--- | :--- |
| **Filesystem / Search** | `read`, `write`, `edit`, `grep`, `glob` | Native Rust/Bun implementation with hashline tags (`[file#TAG]`), ranged reads, archive/SQLite inspection. |
| **GitHub PRs & Issues** | `read pr://<N>/diff`, `read issue://<N>` | Zero-schema internal URI handler; no GitHub MCP server needed for reading issues/PRs. |
| **Remote SSH Files** | `read/write/grep ssh://host/~/path` | Built into `omp` FS tools; no SSH MCP needed. |
| **Code Intelligence** | `xd://lsp`, `xd://ast_edit`, `xd://debug` | Native LSP, AST codemod, and DAP debugger devices loaded on demand via `xd://`. |
| **Browser Automation** | `eval` (`browser.open`, `tab.run`) | Built into the stateful JS/Python `eval` kernel; no Playwright/Puppeteer MCP schema bloat needed in `omp`. |
| **Subagent Orchestration** | `task`, `wait`, `agent://`, `proc://` | Native 32-agent workpool + `agy-crew` skills. |

### 1.2 What `friend-programmer` Should Multiplex (High-Value External Capabilities)

`friend-programmer` should sit behind a **single compact gateway entry** in `dot_omp/private_agent/mcp.json` (and `.claude` / `.devin` MCP configs) and multiplex only external domain tools that `omp` does *not* have natively:

1. **Up-to-Date Library / SDK Documentation (e.g., Context7 / Docs Indexer):**
   - High-SNR query/fetch for version-pinned library docs not present in the local workspace.
2. **Infrastructure & Homelab Control Plane (`thinkcenter-cluster` / Proxmox / Grafana / Tailscale):**
   - Scoped read/inspect endpoints for cluster health, container logs, and metrics (loaded only when working in `infra-ops` archetype or queried on demand).
3. **External Issue Trackers / Knowledge Bases (Linear / Jira / Notion / Sentry):**
   - Compact search + get-by-ID endpoints with response truncation/summarization inside `friend-programmer` before returning to the model.

---

## 2. Design Requirements for the `friend-programmer` Refactor (To Work Seamlessly With `omp`)

When refactoring `friend-programmer` for `omp`:

1. **Progressive Disclosure / Meta-Tool Multiplexing (2-Tool Surface):**
   - Instead of registering 50+ downstream MCP tools onto the top-level tool list, `friend-programmer` should expose a compact multiplexer surface (similar to `omp`'s own `xd://` pattern):
     - `fp_catalog` (or `mcp://friend-programmer/catalog` resource): lists available downstream namespaces/tools with 1-line descriptions.
     - `fp_call({ tool, args })`: validates against the downstream schema and executes the call.
   - *Bonus `omp` integration:* Because `omp`'s `read` tool natively supports **`mcp://<uri>` resources** (see `omp` system prompt: `mcp://<uri>: MCP resource`), `friend-programmer` can expose downstream tool schemas and read-only status dashboards as `mcp://` resources! That way `omp` can `read mcp://fp/schemas/<tool>` on demand with **zero** system-prompt schema overhead.
2. **Output Compaction & SNR Filtering Inside `friend-programmer`:**
   - Downstream MCP servers (Sentry, GitHub, Jira, Grafana) notoriously return 50 KB+ of nested JSON noise (avatars, URLs, permissions metadata).
   - `friend-programmer` should strip boilerplate fields, project only high-signal keys (or convert verbose JSON lists into compact Markdown tables), and cap payload size before returning to `omp`.
3. **Profile / Archetype-Aware Tool Routing:**
   - Read `PWD` or `.agent-profile.md` / environment variables so an `infra-ops` repo sees cluster/infra tools while a `python` / `typescript` repo only sees docs/tracker tools.
4. **Secret Injection via `fnox` / `agent-secrets.env`:**
   - Launch `friend-programmer` with secrets provided by your existing `fnox` / `~/.config/agent-secrets.env` pipeline—never hardcoded tokens in `mcp.json`.

---

## 3. Touchpoints in `mydotfiles` (Once `friend-programmer` Is Ready)

1. **`dot_omp/private_agent/mcp.json` (or `.tmpl`)**:
   - Wire `friend-programmer` as the single MCP server entry:
     ```json
     {
       "mcpServers": {
         "fp": {
           "command": "friend-programmer",
           "args": ["serve", "--profile", "omp"]
         }
       }
     }
     ```
2. **`dot_omp/archetypes/agent-cli.md`**:
   - Document the `mcp://` resource pattern and `fp` multiplexer conventions for agents.
3. **`dot_omp/private_agent/extensions/command-guard/`**:
   - Optionally allow `command-guard` to inspect or gate destructive `fp_call` mutations using the same `permissions.{allow,ask,deny}` engine (`" mcp__fp__* "` rules in Claude/Devin/omp format).

---

## 4. Verification Criteria (When Executed)

1. Verify `omp` startup latency and `/context` tool-token footprint stay under budget (<500 tokens added for the entire `fp` multiplexer).
2. Verify `read mcp://fp/...` resolves catalog/resources cleanly in `omp`.
3. Verify `command-guard` rules (`mcp__fp__*`) govern mutating multiplexer calls across `omp`, `Claude Code`, and `Devin CLI`.
