import * as os from "node:os";
import * as path from "node:path";
import { evaluateCommand } from "./evaluate.ts";
import { loadPermissionLevels } from "./store.ts";

export async function runHook(stdinText: string): Promise<{ stdout?: string; exitCode: number }> {
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(stdinText);
	} catch {
		return { exitCode: 1 };
	}

	if (typeof payload !== "object" || payload === null) {
		return { exitCode: 1 };
	}

	const toolName = String(payload.tool_name ?? payload.toolName ?? "");
	const toolInput = (payload.tool_input ?? payload.toolInput ?? {}) as Record<string, unknown>;
	const command = toolInput.command;

	if (typeof command !== "string" || command.trim().length === 0) {
		return { exitCode: 0 };
	}

	const rawCwd =
		(typeof toolInput.workdir === "string" ? toolInput.workdir : undefined) ??
		(typeof toolInput.cwd === "string" ? toolInput.cwd : undefined) ??
		process.env.DEVIN_PROJECT_DIR ??
		process.env.CLAUDE_PROJECT_DIR ??
		process.cwd();

	const cwd = path.resolve(rawCwd);
	const home = os.homedir();

	const levels = loadPermissionLevels(cwd, home, new Set(), new Set(), new Set(), { mirror: false });
	const verdict = evaluateCommand(command, cwd, home, levels);

	// The hook never approves: allowing plain prefixes stays with native rules/prompts
	if (verdict.verdict === "allow" || verdict.verdict === "unmatched") {
		return { exitCode: 0 };
	}

	const reason = verdict.reasons.join("; ");
	const isDevin = toolName === "exec";

	if (verdict.verdict === "deny") {
		const out = isDevin
			? { decision: "block", reason: `Blocked by command-guard: ${reason}` }
			: {
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						permissionDecision: "deny",
						permissionDecisionReason: `Blocked by command-guard: ${reason}`,
					},
				};
		return { stdout: JSON.stringify(out), exitCode: 0 };
	}

	if (verdict.verdict === "ask") {
		const out = isDevin
			? { decision: "block", reason: `needs human approval: ${reason}` }
			: {
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						permissionDecision: "ask",
						permissionDecisionReason: reason,
					},
				};
		return { stdout: JSON.stringify(out), exitCode: 0 };
	}

	return { exitCode: 0 };
}

if (import.meta.main) {
	try {
		const stdinText = await Bun.stdin.text();
		const result = await runHook(stdinText);
		if (result.stdout) {
			console.log(result.stdout);
		}
		process.exit(result.exitCode);
	} catch (err) {
		console.error("command-guard hook error:", err);
		process.exit(1);
	}
}
