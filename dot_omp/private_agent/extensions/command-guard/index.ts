import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@oh-my-pi/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";
import { commandPrefix, matchesPrefix } from "./normalizer.ts";
import { parseShellCommand, splitShellSegments } from "./parser.ts";
import {
	decideSegment,
	hardCheckReason,
	isProtectedPath,
	isWithinRoots,
	resolvePathWord,
	workspaceRoots,
} from "./rules.ts";
import {
	appendRuleEntries,
	defaultsPath,
	loadPermissionLevels,
	projectLocalPath,
	projectPath,
	userPath,
} from "./store.ts";
import type {
	ParsedSegment,
	ParsedWord,
	PermissionLevel,
	PermissionRules,
	SegmentDecision,
	ShellParseResult,
} from "./types.ts";

export {
	appendRuleEntries,
	commandPrefix,
	decideSegment,
	defaultsPath,
	hardCheckReason,
	isProtectedPath,
	loadPermissionLevels,
	matchesPrefix,
	parseShellCommand,
	projectLocalPath,
	projectPath,
	resolvePathWord,
	splitShellSegments,
	userPath,
};
export type {
	ParsedSegment,
	ParsedWord,
	PermissionLevel,
	PermissionRules,
	SegmentDecision,
	ShellParseResult,
};

const KEEP_RECENT_MESSAGES = 6;
const TRUNCATE_THRESHOLD = 800;
const TRUNCATE_TO = 400;
const TRUNCATION_MARKER = "[command-guard: truncated ";
const FILE_WRITE_TOOLS = new Set(["write", "edit", "ast_edit"]);
const AGENT_SCRATCH_ROOT = path.join(os.homedir(), ".omp", "scratch");

function decisionReason(decision: SegmentDecision): string {
	if (decision.kind === "ask") return decision.persistable ? `ask rule: ${decision.rule}` : decision.rule;
	if (decision.kind === "unmatched") return "unmatched";
	if (decision.kind === "deny") return `deny rule: ${decision.rule}`;
	return "allowed";
}

async function handleBashCall(
	input: { command?: unknown; cwd?: unknown },
	ctx: ExtensionContext,
	sessionAllow: Set<string>,
	sessionAllowOutside: Set<string>,
	sessionAllowedPaths: Set<string>,
): Promise<ToolCallEventResult | void> {
	const command = typeof input.command === "string" ? input.command : "";
	const home = os.homedir();
	const cwd = ctx.cwd;
	const { parsedSegments, complex } = parseShellCommand(command);
	const levels = loadPermissionLevels(cwd, home, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
	const extraRoots = levels.flatMap(l => (l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, cwd, home)));

	const decisions = parsedSegments.map(seg => ({
		words: seg.words,
		decision: decideSegment(seg.words, levels, cwd, home),
	}));
	const pendingDecisions: SegmentDecision[] = [];

	if (typeof input.cwd === "string" && input.cwd.length > 0 && !input.cwd.includes("://")) {
		const resolvedCwd = resolvePathWord(input.cwd, cwd, home);
		if (!isWithinRoots(resolvedCwd, workspaceRoots(cwd, home, extraRoots))) {
			pendingDecisions.push({
				kind: "ask",
				rule: `bash cwd outside workspace: ${input.cwd}`,
				persistable: false,
			});
		}
	}

	const denied = decisions.find(entry => entry.decision.kind === "deny");
	if (denied && denied.decision.kind === "deny") {
		return { block: true, reason: `command-guard: denied by rule "${denied.decision.rule}": ${command}` };
	}

	for (const entry of decisions) {
		if (entry.decision.kind !== "allow") pendingDecisions.push(entry.decision);
	}

	if (pendingDecisions.length === 0 && !complex) return;

	const reasons = [...new Set(pendingDecisions.map(decisionReason))];
	if (complex) reasons.push("command substitution or shell expansion");
	const why = reasons.join("; ");

	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `command-guard: needs approval (${why}); no UI available. Add an allow rule to .omp/permissions.local.json or ~/.omp/agent/permissions.json.`,
		};
	}

	const hasProtected = pendingDecisions.some(
		d => d.kind === "ask" && d.rule.startsWith("protected agent config:"),
	);
	const hasOutside = pendingDecisions.some(
		d => d.kind === "ask" && (d.rule.startsWith("path outside workspace:") || d.rule.startsWith("bash cwd outside workspace:")),
	);
	const normalPersistable =
		!complex &&
		!hasProtected &&
		!hasOutside &&
		pendingDecisions.length > 0 &&
		pendingDecisions.every(
			decision => (decision.kind === "ask" || decision.kind === "unmatched") && decision.persistable,
		);

	const prefixes = [
		...new Set(
			decisions
				.filter(entry => entry.decision.kind !== "allow")
				.map(entry => commandPrefix(entry.words))
				.filter(prefix => prefix.length > 0),
		),
	];

	const onceLabel = "Yes, once";
	const noLabel = "No";
	const sessionLabel = `Yes, for this session: ${prefixes.join(", ")}`;
	const projectLabel = `Yes, always in this project: ${prefixes.join(", ")}`;
	const globalLabel = `Yes, always in all projects: ${prefixes.join(", ")}`;

	const sessionOutsideLabel = `Yes, for this session: allow ${prefixes.join(", ")} outside workspace`;
	const projectOutsideLabel = `Yes, always in this project: allow ${prefixes.join(", ")} outside workspace`;
	const globalOutsideLabel = `Yes, always in all projects: allow ${prefixes.join(", ")} outside workspace`;

	let options = [onceLabel, noLabel];
	if (!complex && !hasProtected && prefixes.length > 0) {
		if (hasOutside) {
			options = [onceLabel, sessionOutsideLabel, projectOutsideLabel, globalOutsideLabel, noLabel];
		} else if (normalPersistable) {
			options = [onceLabel, sessionLabel, projectLabel, globalLabel, noLabel];
		}
	}

	const choice = await ctx.ui.select(`Run command?\n${command}\n${why}`, options);
	if (choice === onceLabel) return;
	if (choice === sessionLabel) {
		for (const prefix of prefixes) sessionAllow.add(prefix);
		return;
	}
	if (choice === projectLabel) {
		appendRuleEntries(projectLocalPath(cwd), "allow", prefixes);
		return;
	}
	if (choice === globalLabel) {
		appendRuleEntries(userPath(home), "allow", prefixes);
		return;
	}
	if (choice === sessionOutsideLabel) {
		for (const prefix of prefixes) {
			sessionAllow.add(prefix);
			sessionAllowOutside.add(prefix);
		}
		return;
	}
	if (choice === projectOutsideLabel) {
		appendRuleEntries(projectLocalPath(cwd), "allow", prefixes);
		appendRuleEntries(projectLocalPath(cwd), "allowOutside", prefixes);
		for (const prefix of prefixes) {
			sessionAllow.add(prefix);
			sessionAllowOutside.add(prefix);
		}
		return;
	}
	if (choice === globalOutsideLabel) {
		appendRuleEntries(userPath(home), "allow", prefixes);
		appendRuleEntries(userPath(home), "allowOutside", prefixes);
		for (const prefix of prefixes) {
			sessionAllow.add(prefix);
			sessionAllowOutside.add(prefix);
		}
		return;
	}
	return { block: true, reason: `User denied: ${command}` };
}

function compactToolResult(message: unknown): unknown {
	if (typeof message !== "object" || message === null) return message;

	const record = message as Record<string, unknown>;
	if (record.role !== "toolResult") return message;

	if (typeof record.content === "string") {
		const text = record.content;
		if (text.length <= TRUNCATE_THRESHOLD || text.includes(TRUNCATION_MARKER)) return message;
		return {
			...record,
			content: `${text.slice(0, TRUNCATE_TO)}\n…${TRUNCATION_MARKER}${text.length - TRUNCATE_TO} chars]`,
		};
	}

	if (!Array.isArray(record.content)) return message;
	const textBlocks = record.content.filter(
		(block): block is { type: "text"; text: string } =>
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "text" &&
			"text" in block &&
			typeof block.text === "string",
	);
	const joinedText = textBlocks.map(block => block.text).join("\n");
	const textLength = textBlocks.reduce((length, block) => length + block.text.length, 0);
	if (textLength <= TRUNCATE_THRESHOLD || joinedText.includes(TRUNCATION_MARKER)) return message;

	const compactedContent: unknown[] = [];
	let insertedSummary = false;
	for (const block of record.content) {
		if (
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "text" &&
			typeof block.text === "string"
		) {
			if (!insertedSummary) {
				compactedContent.push({
					...block,
					text: `${joinedText.slice(0, TRUNCATE_TO)}\n…${TRUNCATION_MARKER}${joinedText.length - TRUNCATE_TO} chars]`,
				});
				insertedSummary = true;
			}
		} else {
			compactedContent.push(block);
		}
	}

	return { ...record, content: compactedContent };
}

function unwrapHashlinePath(rawPath: string): string {
	const wrapped = /^\[(.+?)(?:#[A-Za-z0-9]+)?\]$/u.exec(rawPath.trim());
	return wrapped ? wrapped[1] : rawPath.trim();
}

function resolveTargetPath(rawPath: string, cwd: string): string | undefined {
	const target = unwrapHashlinePath(rawPath);
	if (target.length === 0 || target.includes("://")) return undefined;
	const expanded = target === "~" || target.startsWith("~/") ? path.join(os.homedir(), target.slice(1)) : target;
	return path.resolve(cwd, expanded);
}

function collectWriteTargets(toolName: string, input: Record<string, unknown>): string[] {
	if (!FILE_WRITE_TOOLS.has(toolName)) return [];
	const targets: string[] = [];
	if (typeof input.path === "string") targets.push(input.path);
	if (Array.isArray(input.paths)) {
		for (const entry of input.paths) if (typeof entry === "string") targets.push(entry);
	}
	return targets;
}

export default function (pi: ExtensionAPI) {
	const sessionAllow = new Set<string>();
	const sessionAllowOutside = new Set<string>();
	const sessionAllowedPaths = new Set<string>();
	const sessionWriteDirs = new Set<string>();

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.notify("command-guard: permission shim active");
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			return await handleBashCall(event.input, ctx, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
		}

		const rawTargets = collectWriteTargets(event.toolName, event.input as Record<string, unknown>);
		if (rawTargets.length === 0) return;

		const home = os.homedir();
		const resolvedTargets = rawTargets
			.map(rawTarget => resolveTargetPath(rawTarget, ctx.cwd))
			.filter((target): target is string => target !== undefined);

		const protectedTargets = resolvedTargets.filter(target => isProtectedPath(target, ctx.cwd, home));
		if (protectedTargets.length > 0) {
			const summary = `${event.toolName} targets protected agent config:\n${protectedTargets.join("\n")}`;
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: `command-guard: ${summary}\nNo UI to confirm; ask the user to run it.`,
				};
			}
			const onceLabel = "Yes, once";
			const choice = await ctx.ui.select(`Protected agent config operation\n${summary}`, [
				onceLabel,
				"No",
			]);
			if (choice === onceLabel) return;
			return { block: true, reason: `command-guard: user declined ${summary}` };
		}

		const levels = loadPermissionLevels(ctx.cwd, home, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
		const persistentAllowedPaths = levels.flatMap(l => (l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, ctx.cwd, home)));
		const allowedRoots = [
			ctx.cwd,
			os.homedir(),
			AGENT_SCRATCH_ROOT,
			...persistentAllowedPaths,
			...sessionAllowedPaths,
			...sessionWriteDirs,
		];
		const outsideTargets = resolvedTargets.filter(target => !isWithinRoots(target, allowedRoots));
		if (outsideTargets.length === 0) return;

		const outsideDirs = [...new Set(outsideTargets.map(target => path.dirname(target)))];
		if (outsideDirs.every(dir => sessionWriteDirs.has(dir))) return;

		const summary = `${event.toolName} targets outside workspace ${ctx.cwd}:\n${outsideTargets.join("\n")}`;
		if (!ctx.hasUI) {
			return { block: true, reason: `command-guard: ${summary}\nNo UI to confirm; ask the user to run it.` };
		}
		const onceLabel = "Yes, once";
		const sessionLabel = `Yes, for this session: ${outsideDirs.join(", ")}`;
		const projectLabel = `Yes, always in this project: ${outsideDirs.join(", ")}`;
		const globalLabel = `Yes, always in all projects: ${outsideDirs.join(", ")}`;
		const choice = await ctx.ui.select(`Out-of-workspace operation\n${summary}`, [
			onceLabel,
			sessionLabel,
			projectLabel,
			globalLabel,
			"No",
		]);
		if (choice === onceLabel) return;
		if (choice === sessionLabel) {
			for (const dir of outsideDirs) sessionWriteDirs.add(dir);
			return;
		}
		if (choice === projectLabel) {
			appendRuleEntries(projectLocalPath(ctx.cwd), "allowedPaths", outsideDirs);
			for (const dir of outsideDirs) sessionWriteDirs.add(dir);
			return;
		}
		if (choice === globalLabel) {
			appendRuleEntries(userPath(home), "allowedPaths", outsideDirs);
			for (const dir of outsideDirs) sessionWriteDirs.add(dir);
			return;
		}
		return { block: true, reason: `command-guard: user declined ${summary}` };
	});

	pi.on("context", event => {
		const cutoff = Math.max(0, event.messages.length - KEEP_RECENT_MESSAGES);
		const messages = event.messages.map((message, index) =>
			index < cutoff ? (compactToolResult(message) as typeof message) : message,
		);
		return { messages };
	});

	const parameters = pi.zod.object({
		query: pi.zod.string().describe("The research or planning question for Antigravity."),
	});
	pi.registerTool<typeof parameters>({
		name: "agy_query",
		label: "Antigravity query",
		description:
			"Ask Antigravity (read-only plan mode, prepaid Google credits) for web research or a second-opinion plan.",
		parameters,
		async execute(_toolCallId: string, params: { query: string }, signal?: AbortSignal) {
			const result = await pi.exec("agy", ["--mode", "plan", "--print", params.query], {
				signal,
				timeout: 120_000,
			});
			if (result.code !== 0 || result.killed) {
				const stderr = result.stderr.slice(0, 400);
				throw new Error(
					`agy_query failed with code ${result.code}${result.killed ? " (killed)" : ""}: ${stderr}`,
				);
			}
			return {
				content: [{ type: "text", text: result.stdout }],
				details: { exitCode: result.code },
			};
		},
	});
}
