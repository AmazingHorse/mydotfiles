import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const KEEP_RECENT_MESSAGES = 6;
const TRUNCATE_THRESHOLD = 800;
const TRUNCATE_TO = 400;
const TRUNCATION_MARKER = "[bootstrap-guard: truncated ";

// Native write/edit tools tier every local path as "write", so approvalMode "write"
// would auto-approve edits anywhere on disk. This set is gated to the workspace below.
const FILE_WRITE_TOOLS = new Set(["write", "edit", "ast_edit"]);
const AGENT_SCRATCH_ROOT = path.join(os.homedir(), ".omp", "scratch");

/*
 * ---------------------------------------------------------------------------
 * SHIM: Devin-style bash permissions. omp 18.x has no per-command remembered
 * approvals (bash declares no approvalCacheTargets; session approval covers all
 * bash). Remove when omp supports this natively or sessions run in a sandboxed
 * worktree; then restore bash.patterns in omp-managed-config.yml.
 * ---------------------------------------------------------------------------
 * Rule files are JSON shaped { "allow"?: [], "ask"?: [], "deny"?: [] } where
 * each entry is a command prefix ("git status", "npm run"). Levels, highest to
 * lowest precedence:
 *   session      in-memory, allow-only, granted from the prompt
 *   projectLocal <cwd>/.omp/permissions.local.json   (personal, gitignored)
 *   project      <cwd>/.omp/permissions.json         (shareable, ask/deny only: allow is ignored)
 *   user         ~/.omp/agent/permissions.json       (written by prompts)
 *   defaults     ~/.omp/agent/permissions.defaults.json (chezmoi-managed)
 * A deny match at any level wins outright. A matched ask rule, an unrecognized
 * command, or a hard check (shell reinterpretation, dangerous flags, path
 * escape, or protected agent config) produces one prompt per bash call. Files
 * are re-read on every call.
 * Subagents (task tool) run with ctx.hasUI = false; interactive prompts block,
 * so subagents can only run commands pre-allowed by session, projectLocal, user,
 * or defaults.
 */
export type PermissionRules = {
	allow: string[];
	ask: string[];
	deny: string[];
	allowOutside?: string[];
	allowedPaths?: string[];
};
export type PermissionLevel = {
	name: "session" | "projectLocal" | "project" | "user" | "defaults";
	rules: PermissionRules;
};
export type SegmentDecision =
	| { kind: "allow" }
	| { kind: "deny"; rule: string }
	| { kind: "ask"; rule: string; persistable: boolean }
	| { kind: "unmatched"; persistable: boolean };

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SUBCOMMAND_TOOLS = new Set([
	"git",
	"npm",
	"pnpm",
	"yarn",
	"bun",
	"cargo",
	"go",
	"docker",
	"kubectl",
	"gh",
	"chezmoi",
	"mise",
	"uv",
	"just",
	"pip",
	"python",
	"python3",
	"npx",
]);
const THREE_WORD_PREFIXES = new Set([
	"npm run",
	"pnpm run",
	"yarn run",
	"bun run",
	"uv run",
	"python -m",
	"python3 -m",
]);
const SHELL_INTERPRETERS = new Set(["bash", "sh", "zsh"]);
const DANGEROUS_LONG_FLAG = /^--(output|exec(-batch)?|pre)(=|$)/;

export function splitShellSegments(command: string): { segments: string[][]; complex: boolean } {
	const segments: string[][] = [];
	let words: string[] = [];
	let current = "";
	let complex = false;
	let quote: "'" | '"' | undefined;
	let substitutionDepth = 0;

	const flushWord = () => {
		if (current.length > 0) {
			words.push(current);
			current = "";
		}
	};
	const flushSegment = () => {
		flushWord();
		while (words.length > 0 && ENV_ASSIGNMENT.test(words[0])) words.shift();
		if (words.length > 0) segments.push(words);
		words = [];
	};

	let index = 0;
	while (index < command.length) {
		const char = command[index];

		if (quote === "'") {
			if (char === "'") quote = undefined;
			else current += char;
			index++;
			continue;
		}
		if (quote === '"') {
			if (char === '"') {
				quote = undefined;
				index++;
				continue;
			}
			if (char === "\\" && index + 1 < command.length) {
				current += command[index + 1];
				index += 2;
				continue;
			}
			if (char === "`") complex = true;
			if (char === "$" && command[index + 1] === "(") {
				complex = true;
				current += "$(";
				substitutionDepth++;
				index += 2;
				continue;
			}
			current += char;
			index++;
			continue;
		}

		if (substitutionDepth > 0) {
			if (char === "(") substitutionDepth++;
			else if (char === ")") substitutionDepth--;
			current += char;
			index++;
			continue;
		}

		if (char === "\\") {
			if (index + 1 < command.length) {
				current += command[index + 1];
				index += 2;
			} else {
				index++;
			}
			continue;
		}
		if (char === "'") {
			quote = "'";
			index++;
			continue;
		}
		if (char === '"') {
			quote = '"';
			index++;
			continue;
		}
		if (char === "$" && command[index + 1] === "(") {
			complex = true;
			current += "$(";
			substitutionDepth++;
			index += 2;
			continue;
		}
		if (char === "`") {
			complex = true;
			current += char;
			index++;
			while (index < command.length && command[index] !== "`") {
				current += command[index];
				index++;
			}
			if (index < command.length) {
				current += "`";
				index++;
			}
			continue;
		}
		if ((char === ">" || char === "<") && command[index + 1] === "(") {
			complex = true;
			current += `${char}(`;
			substitutionDepth++;
			index += 2;
			continue;
		}
		if (char === ">" || char === "<") {
			// A bare digit run in front of the operator is an fd, not a word.
			if (/^\d+$/.test(current)) current = "";
			else flushWord();
			index++;
			while (index < command.length && (command[index] === ">" || command[index] === "<")) index++;
			if (command[index] === "|") index++;
			if (command[index] === "&") {
				index++;
				// 2>&1 / <&- duplicate an fd: the target carries no path.
				while (index < command.length && /[0-9-]/.test(command[index])) index++;
			}
			continue;
		}
		if (char === "&") {
			if (command[index + 1] === ">") {
				if (/^\d+$/.test(current)) current = "";
				else flushWord();
				index += 2;
				if (command[index] === ">") index++;
				continue;
			}
			flushSegment();
			index++;
			if (command[index] === "&") index++;
			continue;
		}
		if (char === "|") {
			flushSegment();
			index++;
			if (command[index] === "|" || command[index] === "&") index++;
			continue;
		}
		if (char === ";" || char === "\n") {
			flushSegment();
			index++;
			continue;
		}
		if (/\s/.test(char)) {
			flushWord();
			index++;
			continue;
		}
		current += char;
		index++;
	}
	flushSegment();
	return { segments, complex };
}

export function matchesPrefix(words: string[], prefix: string): boolean {
	const ruleWords = prefix.split(/\s+/).filter(word => word.length > 0);
	if (ruleWords.length === 0 || words.length < ruleWords.length) return false;
	return ruleWords.every((ruleWord, index) => words[index] === ruleWord);
}

export function commandPrefix(words: string[]): string {
	if (words.length === 0) return "";
	const twoWords = words.slice(0, 2).join(" ");
	if (words.length >= 3 && THREE_WORD_PREFIXES.has(twoWords)) return words.slice(0, 3).join(" ");
	if (words.length >= 2 && SUBCOMMAND_TOOLS.has(words[0])) return twoWords;
	return words[0];
}

function looksLikePath(word: string): boolean {
	if (word.includes("://")) return false;
	return (
		word.startsWith("/") ||
		word.startsWith("~") ||
		word.startsWith("..") ||
		word.includes("../") ||
		word.includes("$HOME") ||
		word.includes("${HOME}")
	);
}

function resolvePathWord(word: string, cwd: string, home: string): string {
	let expanded = word;
	if (expanded === "~" || expanded.startsWith("~/")) {
		expanded = path.join(home, expanded.slice(1));
	}
	expanded = expanded.split("$HOME").join(home).split("${HOME}").join(home);
	return path.resolve(cwd, expanded);
}
function isWithinRoot(target: string, root: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realpathOrSelf(directory: string): string {
	try {
		return fs.realpathSync(directory);
	} catch {
		return directory;
	}
}

export function isProtectedPath(resolved: string, cwd: string, home: string): boolean {
	const normalized = path.resolve(resolved);
	const agentDir = path.resolve(home, ".omp", "agent");
	if (isWithinRoot(normalized, agentDir)) return true;

	const projectPerms = path.resolve(cwd, ".omp", "permissions.json");
	const projectLocalPerms = path.resolve(cwd, ".omp", "permissions.local.json");
	if (normalized === projectPerms || normalized === projectLocalPerms) return true;

	const realCwd = realpathOrSelf(cwd);
	if (realCwd !== cwd) {
		if (
			normalized === path.resolve(realCwd, ".omp", "permissions.json") ||
			normalized === path.resolve(realCwd, ".omp", "permissions.local.json")
		) {
			return true;
		}
	}

	const realHome = realpathOrSelf(home);
	if (realHome !== home && isWithinRoot(normalized, path.resolve(realHome, ".omp", "agent"))) {
		return true;
	}

	const realTarget = realpathOrSelf(normalized);
	if (realTarget !== normalized) {
		if (isWithinRoot(realTarget, agentDir)) return true;
		if (realHome !== home && isWithinRoot(realTarget, path.resolve(realHome, ".omp", "agent"))) return true;
		if (realTarget === projectPerms || realTarget === projectLocalPerms) return true;
		if (realCwd !== cwd) {
			if (
				realTarget === path.resolve(realCwd, ".omp", "permissions.json") ||
				realTarget === path.resolve(realCwd, ".omp", "permissions.local.json")
			) {
				return true;
			}
		}
	}

	return false;
}

function workspaceRoots(cwd: string, home: string, extraRoots: string[] = []): string[] {
	return [cwd, realpathOrSelf(cwd), path.join(home, ".omp", "scratch"), ...extraRoots];
}

function isWithinRoots(target: string, roots: string[]): boolean {
	return roots.some(root => isWithinRoot(target, root));
}

function hasShellDashC(words: string[]): boolean {
	for (const word of words.slice(1)) {
		if (word === "--" || !word.startsWith("-")) return false;
		if (word.startsWith("--")) continue;
		if (/^-[^-]*c/.test(word)) return true;
	}
	return false;
}

// Checks no allow rule may satisfy: reinterpretation, dangerous flags, path escape.
function hardCheckReason(
	words: string[],
	cwd: string,
	home: string,
	allowOutsideRules: string[] = [],
	extraRoots: string[] = [],
): string | undefined {
	const first = words[0];
	if (first === "eval" || first === "xargs") return `reinterpreting command: ${first}`;
	if (SHELL_INTERPRETERS.has(first) && hasShellDashC(words)) return `shell -c: ${first}`;
	if (first === "env" && words.slice(1).some(word => !ENV_ASSIGNMENT.test(word) && !word.startsWith("-"))) {
		return "reinterpreting command: env";
	}
	if (first === "find" && words.some(word => word === "-exec" || word === "-execdir" || word === "-delete")) {
		return "find -exec/-delete";
	}
	for (const word of words) {
		if (DANGEROUS_LONG_FLAG.test(word)) return `dangerous flag: ${word}`;
	}
	if (first === "fd" && words.some(word => word === "-x" || word === "-X")) return "fd -x/-X";
	if (first === "git" && words[1] === "-c") return "git -c";

	const candidates = words.flatMap(word => {
		const assignedValue = word.includes("=") ? word.slice(word.indexOf("=") + 1) : undefined;
		return assignedValue ? [word, assignedValue] : [word];
	});

	for (const word of candidates) {
		if (word.startsWith("-") || word.length === 0) continue;
		const resolved = resolvePathWord(word, cwd, home);
		if (isProtectedPath(resolved, cwd, home)) {
			return `protected agent config: ${word}`;
		}
	}

	const isAllowedOutside = allowOutsideRules.some(rule => matchesPrefix(words, rule));
	if (!isAllowedOutside) {
		const roots = workspaceRoots(cwd, home, extraRoots);
		for (const word of candidates) {
			if (!looksLikePath(word)) continue;
			const resolved = resolvePathWord(word, cwd, home);
			if (resolved === "/dev/null" || resolved === "/tmp" || resolved.startsWith("/tmp/")) continue;
			if (isWithinRoots(resolved, roots)) continue;
			return `path outside workspace: ${word}`;
		}
	}
	return undefined;
}


export function decideSegment(
	words: string[],
	levels: PermissionLevel[],
	cwd: string,
	home: string,
): SegmentDecision {
	if (words.length === 0) return { kind: "allow" };

	for (const level of levels) {
		for (const rule of level.rules.deny) {
			if (matchesPrefix(words, rule)) return { kind: "deny", rule };
		}
	}

	const allowOutsideRules = levels.flatMap(l => l.rules.allowOutside ?? []);
	const extraRoots = levels.flatMap(l => (l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, cwd, home)));
	const hardReason = hardCheckReason(words, cwd, home, allowOutsideRules, extraRoots);
	if (hardReason !== undefined) return { kind: "ask", rule: hardReason, persistable: false };
	for (const level of levels) {
		let allowLength = -1;
		let askLength = -1;
		let askRule = "";
		const allowRules = level.name === "project" ? [] : level.rules.allow;
		for (const rule of allowRules) {
			if (matchesPrefix(words, rule)) {
				allowLength = Math.max(allowLength, rule.split(/\s+/).length);
			}
		}
		for (const rule of level.rules.ask) {
			if (matchesPrefix(words, rule)) {
				const length = rule.split(/\s+/).length;
				if (length > askLength) {
					askLength = length;
					askRule = rule;
				}
			}
		}
		if (allowLength < 0 && askLength < 0) continue;
		if (allowLength >= askLength) return { kind: "allow" };
		return { kind: "ask", rule: askRule, persistable: true };
	}
	return { kind: "unmatched", persistable: true };
}

function emptyRules(): PermissionRules {
	return { allow: [], ask: [], deny: [], allowOutside: [], allowedPaths: [] };
}

function readRulesFile(filePath: string): PermissionRules {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyRules();
		const record = parsed as Record<string, unknown>;
		const list = (key: string) =>
			Array.isArray(record[key])
				? (record[key] as unknown[]).filter((entry): entry is string => typeof entry === "string")
				: [];
		return {
			allow: list("allow"),
			ask: list("ask"),
			deny: list("deny"),
			allowOutside: list("allowOutside"),
			allowedPaths: list("allowedPaths"),
		};
	} catch {
		return emptyRules();
	}
}

function projectLocalPath(cwd: string): string {
	return path.join(cwd, ".omp", "permissions.local.json");
}

function projectPath(cwd: string): string {
	return path.join(cwd, ".omp", "permissions.json");
}

function userPath(home: string): string {
	return path.join(home, ".omp", "agent", "permissions.json");
}

function defaultsPath(home: string): string {
	return path.join(home, ".omp", "agent", "permissions.defaults.json");
}

export function loadPermissionLevels(
	cwd: string,
	home: string,
	sessionAllow: ReadonlySet<string> = new Set(),
	sessionAllowOutside: ReadonlySet<string> = new Set(),
	sessionAllowedPaths: ReadonlySet<string> = new Set(),
): PermissionLevel[] {
	const projectRules = readRulesFile(projectPath(cwd));
	return [
		{
			name: "session",
			rules: {
				allow: [...sessionAllow],
				ask: [],
				deny: [],
				allowOutside: [...sessionAllowOutside],
				allowedPaths: [...sessionAllowedPaths],
			},
		},
		{ name: "projectLocal", rules: readRulesFile(projectLocalPath(cwd)) },
		{
			name: "project",
			rules: {
				allow: [],
				ask: projectRules.ask,
				deny: projectRules.deny,
				allowOutside: [],
				allowedPaths: [],
			},
		},
		{ name: "user", rules: readRulesFile(userPath(home)) },
		{ name: "defaults", rules: readRulesFile(defaultsPath(home)) },
	];
}

function appendRuleEntries(filePath: string, key: "allow" | "allowOutside" | "allowedPaths", entries: string[]): void {
	let record: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			record = parsed as Record<string, unknown>;
		}
	} catch {
		// Missing or invalid file: start from an empty object.
	}
	const existing = Array.isArray(record[key])
		? (record[key] as unknown[]).filter((entry): entry is string => typeof entry === "string")
		: [];
	record[key] = [...new Set([...existing, ...entries])];
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

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
	const { segments, complex } = splitShellSegments(command);
	const levels = loadPermissionLevels(cwd, home, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
	const extraRoots = levels.flatMap(l => (l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, cwd, home)));

	const decisions = segments.map(words => ({ words, decision: decideSegment(words, levels, cwd, home) }));
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
		return { block: true, reason: `bootstrap-guard: denied by rule "${denied.decision.rule}": ${command}` };
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
			reason: `bootstrap-guard: needs approval (${why}); no UI available. Add an allow rule to .omp/permissions.local.json or ~/.omp/agent/permissions.json.`,
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
/*
 * ---------------------------------------------------------------------------
 * When the `fp` CLI lands, compactToolResult() becomes the seam: instead of a
 * blind head-truncation, pipe the old tool result through
 *     pi.exec("fp", ["compact", "--max-chars", String(TRUNCATE_TO)], { input })
 * and fall back to the truncation below on non-zero exit or timeout. Keep the
 * TRUNCATION_MARKER check so already-compacted results are never re-processed.
 * ---------------------------------------------------------------------------
 */
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
			ctx.ui.notify("bootstrap-guard: permission shim active");
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
					reason: `bootstrap-guard: ${summary}\nNo UI to confirm; ask the user to run it.`,
				};
			}
			const onceLabel = "Yes, once";
			const choice = await ctx.ui.select(`Protected agent config operation\n${summary}`, [
				onceLabel,
				"No",
			]);
			if (choice === onceLabel) return;
			return { block: true, reason: `bootstrap-guard: user declined ${summary}` };
		}

		const levels = loadPermissionLevels(ctx.cwd, home, sessionAllow, sessionAllowOutside, sessionAllowedPaths);
		const persistentAllowedPaths = levels.flatMap(l => (l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, ctx.cwd, home)));
		const allowedRoots = [
			ctx.cwd,
			realpathOrSelf(ctx.cwd),
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
			return { block: true, reason: `bootstrap-guard: ${summary}\nNo UI to confirm; ask the user to run it.` };
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
		return { block: true, reason: `bootstrap-guard: user declined ${summary}` };
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
		async execute(_toolCallId, params, signal) {
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
