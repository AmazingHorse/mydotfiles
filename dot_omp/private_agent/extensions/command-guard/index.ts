import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@oh-my-pi/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";
import { type CommandVerdict, decisionReason, evaluateCommand } from "./evaluate.ts";
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
	flushPendingMirrors,
	loadPermissionLevels,
	projectLocalPath,
	projectPath,
	savePathRule,
	saveRule,
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
	decisionReason,
	defaultsPath,
	evaluateCommand,
	flushPendingMirrors,
	hardCheckReason,
	isProtectedPath,
	loadPermissionLevels,
	matchesPrefix,
	parseShellCommand,
	projectLocalPath,
	projectPath,
	resolvePathWord,
	savePathRule,
	saveRule,
	splitShellSegments,
	userPath,
	workspaceRoots,
};
export type {
	ParsedSegment,
	ParsedWord,
	PermissionLevel,
	PermissionRules,
	SegmentDecision,
	ShellParseResult,
	CommandVerdict,
};

const KEEP_RECENT_MESSAGES = 6;
const TRUNCATE_THRESHOLD = 800;
const TRUNCATE_TO = 400;
const TRUNCATION_MARKER = "[command-guard: truncated ";
const FILE_WRITE_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
};

// Hoisted module-level session state across subagents and sibling instances
const sessionAllow = new Set<string>();
const sessionAllowOutside = new Set<string>();
const sessionAllowedPaths = new Set<string>();
const sessionWriteDirs = new Set<string>();

export function clearSessionState(): void {
	sessionAllow.clear();
	sessionAllowOutside.clear();
	sessionAllowedPaths.clear();
	sessionWriteDirs.clear();
}

class AsyncMutex {
	private queue: Array<() => void> = [];
	private locked = false;

	async lock(): Promise<() => void> {
		if (!this.locked) {
			this.locked = true;
			return () => this.unlock();
		}
		const { promise, resolve } = Promise.withResolvers<() => void>();
		this.queue.push(() => resolve(() => this.unlock()));
		return promise;
	}

	private unlock(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.locked = false;
		}
	}

	async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		const release = await this.lock();
		try {
			return await fn();
		} finally {
			release();
		}
	}
}

const approvalMutex = new AsyncMutex();


async function handleBashCall(
	input: { command?: unknown; cwd?: unknown },
	ctx: ExtensionContext,
): Promise<ToolCallEventResult | void> {
	if (typeof input.command !== "string") return;
	const command = input.command;
	const cwd = typeof input.cwd === "string" ? path.resolve(ctx.cwd, input.cwd) : ctx.cwd;
	const home = os.homedir();

	const evaluateDecisions = () => {
		const levels = loadPermissionLevels(cwd, home, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
		const verdict = evaluateCommand(command, cwd, home, levels);
		const denied = verdict.decisions.find(d => d.decision.kind === "deny");
		const pendingDecisions: SegmentDecision[] = [];
		if (verdict.complex) {
			pendingDecisions.push({
				kind: "ask",
				rule: "complex shell syntax (command substitution, redirections, or multiline flow)",
				persistable: false,
			});
		}
		for (const entry of verdict.decisions) {
			if (entry.decision.kind === "ask" || entry.decision.kind === "unmatched") {
				pendingDecisions.push(entry.decision);
			}
		}
		return {
			levels,
			verdict,
			parsedSegments: verdict.decisions.map(d => ({ words: d.words })),
			complex: verdict.complex,
			decisions: verdict.decisions,
			denied,
			pendingDecisions,
		};
	};

	// Fast path check without mutex
	const initial = evaluateDecisions();
	if (initial.denied) {
		const reason = decisionReason(initial.denied.decision);
		return { block: true, reason: `Blocked by command-guard: ${reason}` };
	}
	if (initial.pendingDecisions.length === 0) {
		return;
	}

	// Prompt required: serialize with approval mutex to prevent parallel racing
	return await approvalMutex.runExclusive(async () => {
		// Re-evaluate within lock in case sibling parallel tool call already approved
		const fresh = evaluateDecisions();
		if (fresh.denied) {
			const reason = decisionReason(fresh.denied.decision);
			return { block: true, reason: `Blocked by command-guard: ${reason}` };
		}
		if (fresh.pendingDecisions.length === 0) {
			return;
		}

		const why = fresh.pendingDecisions.map(d => decisionReason(d)).join("; ");
		const hasProtected = fresh.pendingDecisions.some(
			d => d.kind === "ask" && d.rule.startsWith("protected agent config:"),
		);
		const hasOutside = fresh.pendingDecisions.some(
			d => d.kind === "ask" && (d.rule.startsWith("path outside workspace:") || Boolean(d.outsidePaths?.length)),
		);

		const outsideDirs: string[] = [];
		for (const d of fresh.pendingDecisions) {
			if (d.kind === "ask" && d.outsidePaths) {
				for (const p of d.outsidePaths) {
					outsideDirs.push(path.dirname(resolvePathWord(p, cwd, home)));
				}
			}
		}
		const uniqueOutsideDirs = [...new Set(outsideDirs)];

		const normalPersistable =
			!fresh.complex &&
			!hasProtected &&
			!hasOutside &&
			fresh.pendingDecisions.length > 0 &&
			fresh.pendingDecisions.every(
				decision => (decision.kind === "ask" || decision.kind === "unmatched") && decision.persistable,
			);

		const prefixes = [
			...new Set(
				fresh.decisions
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

		let options = [onceLabel];
		if (!fresh.complex && !hasProtected && prefixes.length > 0) {
			if (hasOutside) {
				options.push(sessionOutsideLabel, projectOutsideLabel, globalOutsideLabel);
				for (const dir of uniqueOutsideDirs) {
					options.push(`Trust directory ${dir} (session)`);
					options.push(`Trust directory ${dir} (save to project-local)`);
				}
			} else if (normalPersistable) {
				options.push(sessionLabel, projectLabel, globalLabel);
			}
		}
		options.push(noLabel);

		const choice = await ctx.ui.select(`Run command?\n${command}\n${why}`, options);
		if (choice === onceLabel) return;

		if (choice === sessionLabel) {
			for (const prefix of prefixes) sessionAllow.add(prefix);
			if (hasOutside) {
				for (const prefix of prefixes) sessionAllowOutside.add(prefix);
			}
			return;
		}
		if (choice === projectLabel) {
			for (const prefix of prefixes) {
				sessionAllow.add(prefix);
				await saveRule("projectLocal", "allow", prefix, cwd, home);
			}
			return;
		}
		if (choice === globalLabel) {
			for (const prefix of prefixes) {
				sessionAllow.add(prefix);
				await saveRule("user", "allow", prefix, cwd, home);
			}
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
			for (const prefix of prefixes) {
				sessionAllow.add(prefix);
				sessionAllowOutside.add(prefix);
				await saveRule("projectLocal", "allow", prefix, cwd, home);
				await saveRule("projectLocal", "allowOutside", prefix, cwd, home);
			}
			return;
		}
		if (choice === globalOutsideLabel) {
			for (const prefix of prefixes) {
				sessionAllow.add(prefix);
				sessionAllowOutside.add(prefix);
				await saveRule("user", "allow", prefix, cwd, home);
				await saveRule("user", "allowOutside", prefix, cwd, home);
			}
			return;
		}

		for (const dir of uniqueOutsideDirs) {
			if (choice === `Trust directory ${dir} (session)`) {
				sessionAllowedPaths.add(dir);
				sessionWriteDirs.add(dir);
				for (const prefix of prefixes) sessionAllow.add(prefix);
				return;
			}
			if (choice === `Trust directory ${dir} (save to project-local)`) {
				sessionAllowedPaths.add(dir);
				sessionWriteDirs.add(dir);
				for (const prefix of prefixes) sessionAllow.add(prefix);
				await savePathRule("projectLocal", dir, cwd, home);
				return;
			}
		}

		return { block: true, reason: `User denied: ${command}` };
	});
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
	if (!FILE_WRITE_TOOLS[toolName]) return [];
	const targets: string[] = [];
	if (typeof input.path === "string") targets.push(input.path);
	if (Array.isArray(input.paths)) {
		for (const entry of input.paths) if (typeof entry === "string") targets.push(entry);
	}
	return targets;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			return handleBashCall(event.input as { command?: unknown; cwd?: unknown }, ctx);
		}

		if (!FILE_WRITE_TOOLS[event.toolName]) return;

		const rawTargets = collectWriteTargets(event.toolName, (event.input ?? {}) as Record<string, unknown>);
		if (rawTargets.length === 0) return;

		const home = os.homedir();
		const resolvedTargets = [
			...new Set(
				rawTargets
					.map(target => resolveTargetPath(target, ctx.cwd))
					.filter((target): target is string => typeof target === "string"),
			),
		];
		if (resolvedTargets.length === 0) return;

		for (const target of resolvedTargets) {
			if (isProtectedPath(target, ctx.cwd, home)) {
				return {
					block: true,
					reason: `Blocked by command-guard: write target is a protected configuration path (${target})`,
				};
			}
		}

		const levels = loadPermissionLevels(ctx.cwd, home, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
		const configuredAllowedPaths = levels.flatMap(l =>
			(l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, ctx.cwd, home)),
		);
		const configuredWriteRules = levels.flatMap(l => l.rules.writeRules ?? []);

		const roots = workspaceRoots(ctx.cwd, home, [
			...sessionAllowedPaths,
			...sessionWriteDirs,
			...configuredAllowedPaths,
			...configuredWriteRules,
		]);

		const outsideTargets = resolvedTargets.filter(target => !isWithinRoots(target, roots));
		if (outsideTargets.length === 0) return;

		const outsideDirs = [...new Set(outsideTargets.map(target => path.dirname(target)))];
		if (outsideDirs.every(dir => sessionWriteDirs.has(dir))) return;

		return await approvalMutex.runExclusive(async () => {
			const freshRoots = workspaceRoots(ctx.cwd, home, [
				...sessionAllowedPaths,
				...sessionWriteDirs,
				...configuredAllowedPaths,
				...configuredWriteRules,
			]);
			const stillOutside = outsideTargets.filter(target => !isWithinRoots(target, freshRoots));
			if (stillOutside.length === 0) return;

			const dirs = [...new Set(stillOutside.map(target => path.dirname(target)))];
			if (dirs.every(dir => sessionWriteDirs.has(dir))) return;

			const onceLabel = "Yes, once";
			const noLabel = "No";
			const options = [onceLabel];
			for (const dir of dirs) {
				options.push(`Trust directory ${dir} (session)`);
				options.push(`Trust directory ${dir} (save to project-local)`);
			}
			options.push(noLabel);

			const summary = `${event.toolName} targets outside workspace:\n${stillOutside.join("\n")}`;
			const choice = await ctx.ui.select(`Allow file modification?\n${summary}`, options);

			if (choice === onceLabel) return;
			for (const dir of dirs) {
				if (choice === `Trust directory ${dir} (session)`) {
					sessionWriteDirs.add(dir);
					sessionAllowedPaths.add(dir);
					return;
				}
				if (choice === `Trust directory ${dir} (save to project-local)`) {
					sessionWriteDirs.add(dir);
					sessionAllowedPaths.add(dir);
					await savePathRule("projectLocal", dir, ctx.cwd, home);
					return;
				}
			}
			return {
				block: true,
				reason: `Blocked by command-guard: write target outside workspace (${stillOutside[0]})`,
			};
		});
	});

	pi.on("context", async event => {
		const messages = event.messages;
		if (messages.length <= KEEP_RECENT_MESSAGES) return;

		const cutoff = messages.length - KEEP_RECENT_MESSAGES;
		const compacted = messages.map((msg, index) => {
			if (index >= cutoff) return msg;
			return compactToolResult(msg);
		});

		return { messages: compacted };
	});
}
