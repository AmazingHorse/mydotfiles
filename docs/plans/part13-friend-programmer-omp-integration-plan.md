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

## 1.3 Prior Art Catalogue for Sections 2.1–2.2 (Build vs. Borrow)

Before building or refactoring `friend-programmer`, we surveyed the open-source ecosystem for (a) lazy/meta-tool MCP multiplexers, (b) semantic/AST/skeleton code tools, and (c) output compaction proxies:

| Project | Language / License | What It Implements | Build vs. Borrow Verdict for `friend-programmer` |
| :--- | :--- | :--- | :--- |
| **[`voicetreelab/lazy-mcp`](https://github.com/voicetreelab/lazy-mcp)** | Go (MIT, ~115★) | Replaces downstream MCP tool lists with 2 meta-tools: `get_tools_in_category(path)` (hierarchical tree navigation of servers/tools) and `execute_tool(tool_path, arguments)`. Spawns stdio/HTTP servers lazily on first call. | **Borrow the 2-tool tree-navigation pattern** (`describe_tools` + `execute_tool`), or embed directly in `friend-programmer` (TypeScript/Bun). |
| **[`shajij/mcp-gate`](https://github.com/shajij/mcp-gate)** & **[`sarthakpranesh/mcp-lazy-proxy`](https://github.com/sarthakpranesh/mcp-lazy-proxy)** | JS/TS (MIT) | Lightweight (~300 LOC) MCP gateways using `@modelcontextprotocol/sdk` that expose `discover_tools` + `call_tool`, spawn backends on first use, and reap idle child processes after a TTL. | **Reference implementation for process lifecycle** (lazy stdio spawn + idle TTL reap + per-project `.fp.json` / template config loading). |
| **[`oraios/serena`](https://github.com/oraios/serena)** | Python (31k+★) | Full semantic code retrieval & symbol-level skeleton/editing MCP server (`find_symbol`, `get_symbols_overview`, `find_referencing_symbols`). | **Do NOT duplicate in `omp` (`omp` already has native `xd://lsp` + bare `read` code skeletons!),** *but* borrow Serena's `get_symbols_overview` output format if exposing skeleton/semantic search to harnesses without native LSP. |
| **[`ast-grep/ast-grep-mcp`](https://github.com/ast-grep/ast-grep-mcp)** / **[`GodSpeedAI/ast-grep-mcp-rs`](https://github.com/GodSpeedAI/ast-grep-mcp-rs)** | TS / Rust (MIT) | Exposes structural AST search (`find_code_by_rule`, `dump_syntax_tree`). | **`omp` has `xd://ast_edit` for rewrites**, but exposing a fast read-only `ast_search` or semantic vector index via `friend-programmer` is high-leverage if paired with anti-reconfirmation framing (see §2.5 below). |

### Why Customizing `friend-programmer` (Rather Than Using a Stock Proxy) Is Worth It:
Stock lazy proxies (`lazy-mcp`, `mcp-gate`) **only** solve schema lazy-loading (2.1); **none of them** implement:
1. **Harness-aware tool suppression** (hiding filesystem/LSP/browser MCPs when `--profile omp` is active while exposing them to weaker harnesses).
2. **Response payload compaction / SNR projection (2.2)** (stripping 50 KB of JSON noise into compact Markdown tables).
3. **Per-project / Copier-template declarative toolset activation** (`.fp.toml` or `.agent-profile.md` loading only the MCPs relevant to that repo).
4. **Anti-reconfirmation result framing** (preventing the agent from re-running `grep`/`read` to "double check" the multiplexer's answer).

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

5. **Per-Harness Anti-Reconfirmation Strategy (Preventing Double-Check Token Waste Across `agy`, `Claude Code`, `Devin`, and `omp`):**
   - As observed in SWE-Polybench runs (where `agy` was the harness under test), semantic search, `ast-grep`, and code-skeleton tools only reduce turns and tokens if the harness **trusts the returned snippet/skeleton** and does not immediately invoke its native `view_file` / `Read` / `grep_search` to "re-confirm" the answer.
   - Each harness has a different edit-precondition mechanism, so `friend-programmer` (`--profile <harness>`) + `.chezmoitemplates/agent-core.md` must handle all four:

     | Harness | Why It Re-Confirms by Default | How `friend-programmer` + `mydotfiles` Prevents Double-Checking |
     | :--- | :--- | :--- |
     | **`agy` (Antigravity)** | `replace_file_content` requires `StartLine`, `EndLine`, and exact `TargetContent` (including whitespace), and `agy`'s system prompt tells it to call `view_file` before editing. | 1. Format slices with **1-indexed line numbers + verbatim indentation** matching `view_file` (`StartLine`–`EndLine`).<br>2. Prepend in-band directive: `[FILE: path \| LINES: N-M of TOTAL \| VERBATIM: true — Exact file contents. Do NOT call view_file/grep_search to re-confirm; use directly for analysis or replace_file_content.]`<br>3. Append `[EXHAUSTIVE: K/K matches returned; 0 other occurrences exist]` on AST/exact searches so `agy` does not run a fallback `grep_search`. |
     | **`Claude Code` & `Devin CLI`** | Both enforce a hard stateful check in their native `Edit` tool (`"File has not been read yet. Read it first"`): calling an MCP tool does *not* flip the harness's internal `readFiles.has(path)` bit. | 1. **Phase A (Triage / Non-Edited Files):** The `[VERBATIM: true]` + `[EXHAUSTIVE]` headers + global rule in `CLAUDE.md`/`AGENTS.md` stop the agent from calling `Read` on the 80% of inspected files it does *not* edit.<br>2. **Phase B (Edited Files):** Either (a) expose an `fp_edit` tool inside `friend-programmer` (or a `PreToolUse` hook) so edits on `fp`-read files succeed directly without a redundant native `Read`, or (b) return tight `offset`/`limit` ranges so the required pre-edit `Read` fetches only the 20 target lines instead of the whole file. |
     | **`omp`** | `omp`'s `edit` requires a 4-hex hashline snapshot tag (`[file.ts#1A2B]`) generated by `omp`'s native `read`, and `omp`'s bare `read({ path })` already returns code skeletons natively. | 1. Suppress redundant skeleton MCP tools in `--profile omp` (let `omp` use native bare `read`).<br>2. Have `fp` semantic/`ast-grep` search return ranked `path:start-end` selectors + 3–5 line previews so `omp` skips multi-turn `grep` loops and calls `read({ path: "file.ts:start-end" })` once on the exact target range to get `[file.ts#TAG]`. |

   - **Global Prompt Rule in `.chezmoitemplates/agent-core.md` (propagates to `~/.gemini/GEMINI.md` for `agy`, `~/.claude/CLAUDE.md`, `~/.config/devin/AGENTS.md`, and `~/.omp/agent/AGENTS.md`):**
     - Add a standing rule to `agent-core.md`: *"Treat `friend-programmer` (`fp_*`) outputs marked `VERBATIM: true` or `EXHAUSTIVE` as authoritative ground truth—never re-run `view_file`, `Read`, `grep`, or `find` to re-confirm them."*
6. **Per-Project / Template Declarative MCP Loading (`.fp.toml`):**
   - Rather than maintaining a static global list of MCP servers, allow Copier templates (`copier-base`, `copier-infra-ops`, `copier-laravel-php`, etc.) to ship a tiny `.fp.toml` (or section in `mise.toml`) declaring which MCP backends apply to that project (`[mcps] context7 = true`, `laravel_boost = true`, `proxmox = true`), spawned lazily by `friend-programmer` on first query and reaped after idle TTL.
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

4. **`.chezmoitemplates/agent-core.md`**:
   - Add the cross-harness anti-reconfirmation rule so `agy` (`~/.gemini/GEMINI.md`), `Claude Code` (`~/.claude/CLAUDE.md`), `Devin CLI` (`~/.config/devin/AGENTS.md`), and `omp` (`~/.omp/agent/AGENTS.md`) all trust `VERBATIM` / `EXHAUSTIVE` `friend-programmer` responses without double-checking.
---

## 4. Verification Criteria (When Executed)

1. Verify `omp` startup latency and `/context` tool-token footprint stay under budget (<500 tokens added for the entire `fp` multiplexer).
2. Verify `read mcp://fp/...` resolves catalog/resources cleanly in `omp`.
3. Verify `command-guard` rules (`mcp__fp__*`) govern mutating multiplexer calls across `omp`, `Claude Code`, and `Devin CLI`.
