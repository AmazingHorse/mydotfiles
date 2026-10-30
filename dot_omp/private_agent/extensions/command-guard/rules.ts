import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { matchesPrefix } from "./normalizer.ts";
import type { ParsedWord, PermissionLevel, SegmentDecision } from "./types.ts";

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_INTERPRETERS: Record<string, true> = {
	bash: true,
	sh: true,
	zsh: true,
};
const DANGEROUS_LONG_FLAG = /^--(output|exec(-batch)?|pre)(=|$)/;

export function looksLikePath(word: string): boolean {
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

export function resolvePathWord(word: string, cwd: string, home: string): string {
	let expanded = word;
	if (expanded === "~" || expanded.startsWith("~/")) {
		expanded = path.join(home, expanded.slice(1));
	}
	expanded = expanded.split("$HOME").join(home).split("${HOME}").join(home);
	return path.resolve(cwd, expanded);
}

export function isWithinRoot(target: string, root: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function realpathOrSelf(directory: string): string {
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

export function workspaceRoots(cwd: string, home: string, extraRoots: string[] = []): string[] {
	return [cwd, realpathOrSelf(cwd), path.join(home, ".omp", "scratch"), ...extraRoots];
}

export function isWithinRoots(target: string, roots: string[]): boolean {
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

export function hardCheckReason(
	inputWords: string[] | ParsedWord[],
	cwd: string,
	home: string,
	allowOutsideRules: string[] = [],
	extraRoots: string[] = [],
): string | undefined {
	const rawWords = inputWords.map(w => (typeof w === "string" ? w : w.text));
	if (rawWords.length === 0) return undefined;

	const first = rawWords[0];
	if (first === "eval" || first === "xargs") return `reinterpreting command: ${first}`;
	if (SHELL_INTERPRETERS[first] && hasShellDashC(rawWords)) return `shell -c: ${first}`;
	if (first === "env" && rawWords.slice(1).some(word => !ENV_ASSIGNMENT.test(word) && !word.startsWith("-"))) {
		return "reinterpreting command: env";
	}
	if (first === "find" && rawWords.some(word => word === "-exec" || word === "-execdir" || word === "-delete")) {
		return "find -exec/-delete";
	}
	for (const word of rawWords) {
		if (DANGEROUS_LONG_FLAG.test(word)) return `dangerous flag: ${word}`;
	}
	if (first === "fd" && rawWords.some(word => word === "-x" || word === "-X")) return "fd -x/-X";
	if (first === "git" && (rawWords[1] === "-c" || rawWords.some(w => w.startsWith("--config-env")))) return "git -c";

	// Convert inputWords into candidate objects with metadata
	type Candidate = {
		text: string;
		isRedirectTarget?: boolean;
		quote?: "'" | '"' | "mixed";
		hasTemplate?: boolean;
	};

	const candidates: Candidate[] = [];
	for (const word of inputWords) {
		const isString = typeof word === "string";
		const text = isString ? word : word.text;
		const quote = isString ? undefined : word.quote;
		const isRedirectTarget = isString ? undefined : word.isRedirectTarget;
		const hasTemplate = isString ? undefined : word.hasTemplate;

		candidates.push({ text, quote, isRedirectTarget, hasTemplate });

		if (text.includes("=")) {
			const eqIndex = text.indexOf("=");
			candidates.push({
				text: text.slice(eqIndex + 1),
				quote,
				isRedirectTarget,
				hasTemplate,
			});
		}
	}

	// 1. Protected path check: runs for ALL candidates
	for (const cand of candidates) {
		if (cand.text.startsWith("-") || cand.text.length === 0) continue;
		// Skip template literals unless explicitly a redirection target
		if (cand.hasTemplate && !cand.isRedirectTarget) continue;
		// Skip single-quoted literals that don't look like concrete paths
		if (cand.quote === "'" && !cand.isRedirectTarget && !cand.text.startsWith("/") && !cand.text.startsWith(".")) {
			continue;
		}

		const resolved = resolvePathWord(cand.text, cwd, home);
		if (isProtectedPath(resolved, cwd, home)) {
			return `protected agent config: ${cand.text}`;
		}
	}

	// 2. Workspace boundary check: skipped if command matches allowOutside
	const isAllowedOutside = allowOutsideRules.some(rule => matchesPrefix(rawWords, rule));
	if (!isAllowedOutside) {
		const roots = workspaceRoots(cwd, home, extraRoots);
		for (const cand of candidates) {
			if (cand.text.startsWith("-") || cand.text.length === 0) continue;
			// Ignore template expressions in arguments
			if (cand.hasTemplate && !cand.isRedirectTarget) continue;
			// Single-quoted strings in bash do not expand $HOME or ~
			if (cand.quote === "'" && !cand.isRedirectTarget && !cand.text.startsWith("/") && !cand.text.startsWith(".")) {
				continue;
			}
			if (!looksLikePath(cand.text)) continue;

			const resolved = resolvePathWord(cand.text, cwd, home);
			if (resolved === "/dev/null" || resolved === "/tmp" || resolved.startsWith("/tmp/")) continue;
			if (isWithinRoots(resolved, roots)) continue;
			return `path outside workspace: ${cand.text}`;
		}
	}

	return undefined;
}

export function decideSegment(
	words: string[] | ParsedWord[],
	levels: PermissionLevel[],
	cwd: string,
	home: string,
): SegmentDecision {
	const rawWords = words.map(w => (typeof w === "string" ? w : w.text));
	if (rawWords.length === 0) return { kind: "allow" };

	// 1. Deny check across all levels
	for (const level of levels) {
		for (const rule of level.rules.deny) {
			if (matchesPrefix(words, rule)) return { kind: "deny", rule };
		}
	}

	// 2. Hard checks: reinterpretation, dangerous flags, workspace escape, protected paths
	const allowOutsideRules = levels.flatMap(l => l.rules.allowOutside ?? []);
	const extraRoots = levels.flatMap(l => (l.rules.allowedPaths ?? []).map(p => resolvePathWord(p, cwd, home)));
	const hardReason = hardCheckReason(words, cwd, home, allowOutsideRules, extraRoots);
	if (hardReason !== undefined) {
		return { kind: "ask", rule: hardReason, persistable: false };
	}

	// 3. Allow vs Ask precedence
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
