import type { PermissionRules } from "./types.ts";

const globCache = new Map<string, InstanceType<typeof Bun.Glob>>();

export function matchesGlob(pattern: string, targetPath: string): boolean {
	try {
		let glob = globCache.get(pattern);
		if (!glob) {
			glob = new Bun.Glob(pattern);
			if (globCache.size > 256) globCache.clear();
			globCache.set(pattern, glob);
		}
		return glob.match(targetPath);
	} catch {
		return false;
	}
}

export function isClaudePrefixRule(rule: string): boolean {
	return rule.startsWith("Bash(") && rule.endsWith(")");
}

export function parseClaudePrefix(rule: string): string | undefined {
	if (!isClaudePrefixRule(rule)) return undefined;
	let val = rule.slice(5, -1).trim();
	if (val.endsWith(" *")) val = val.slice(0, -2).trim();
	else if (val.endsWith(":*")) val = val.slice(0, -2).trim();
	else if (val.endsWith("*") && val.length > 1 && val[val.length - 2] === " ") {
		val = val.slice(0, -1).trim();
	}
	return val.length > 0 ? val : undefined;
}

export function isDevinPrefixRule(rule: string): boolean {
	return rule.startsWith("Exec(") && rule.endsWith(")");
}

export function parseDevinPrefix(rule: string): string | undefined {
	if (!isDevinPrefixRule(rule)) return undefined;
	const val = rule.slice(5, -1).trim();
	return val.length > 0 ? val : undefined;
}

function parsePathGlob(rule: string): string | undefined {
	const match = rule.match(/^(?:Edit|Write)\((.*)\)$/);
	return match ? match[1].trim() : undefined;
}

export function formatClaudePrefix(prefix: string): string {
	if (["pwd", "cd", "whoami", "id"].includes(prefix)) return `Bash(${prefix})`;
	return `Bash(${prefix} *)`;
}

export function formatDevinPrefix(prefix: string): string {
	return `Exec(${prefix})`;
}

export function fromClaudePermissions(permissions: {
	allow?: string[];
	ask?: string[];
	deny?: string[];
}): PermissionRules {
	const rules: PermissionRules = {
		allow: [],
		ask: [],
		deny: [],
		allowedPaths: [],
	};

	const extractPrefixes = (list: string[] | undefined, target: "allow" | "ask" | "deny") => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (typeof item !== "string") continue;
			const prefix = parseClaudePrefix(item);
			if (prefix !== undefined) {
				rules[target].push(prefix);
			} else if (target === "allow") {
				// Read-only path glob extraction for omp's internal path checks
				const pathGlob = parsePathGlob(item);
				if (pathGlob !== undefined) {
					rules.allowedPaths!.push(pathGlob);
				}
			}
		}
	};

	extractPrefixes(permissions.allow, "allow");
	extractPrefixes(permissions.ask, "ask");
	extractPrefixes(permissions.deny, "deny");

	return deduplicateRules(rules);
}

export function fromDevinPermissions(permissions: {
	allow?: string[];
	ask?: string[];
	deny?: string[];
}): PermissionRules {
	const rules: PermissionRules = {
		allow: [],
		ask: [],
		deny: [],
		allowedPaths: [],
	};

	const extractPrefixes = (list: string[] | undefined, target: "allow" | "ask" | "deny") => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (typeof item !== "string") continue;
			const prefix = parseDevinPrefix(item);
			if (prefix !== undefined) {
				rules[target].push(prefix);
			} else if (target === "allow") {
				// Read-only path glob extraction for omp's internal path checks
				const pathGlob = parsePathGlob(item);
				if (pathGlob !== undefined) {
					rules.allowedPaths!.push(pathGlob);
				}
			}
		}
	};

	extractPrefixes(permissions.allow, "allow");
	extractPrefixes(permissions.ask, "ask");
	extractPrefixes(permissions.deny, "deny");

	return deduplicateRules(rules);
}

export function fromOmpJson(json: Record<string, unknown>): PermissionRules {
	if (json.permissions && typeof json.permissions === "object") {
		const perms = json.permissions as Record<string, unknown>;
		const rules: PermissionRules = {
			allow: Array.isArray(perms.allow) ? (perms.allow as string[]) : [],
			ask: Array.isArray(perms.ask) ? (perms.ask as string[]) : [],
			deny: Array.isArray(perms.deny) ? (perms.deny as string[]) : [],
			allowOutside: Array.isArray(perms.allowOutside) ? (perms.allowOutside as string[]) : [],
			allowedPaths: Array.isArray(perms.allowedPaths) ? (perms.allowedPaths as string[]) : [],
		};
		return deduplicateRules(rules);
	}

	const rules: PermissionRules = {
		allow: Array.isArray(json.allow) ? (json.allow as string[]) : [],
		ask: Array.isArray(json.ask) ? (json.ask as string[]) : [],
		deny: Array.isArray(json.deny) ? (json.deny as string[]) : [],
		allowOutside: Array.isArray(json.allowOutside) ? (json.allowOutside as string[]) : [],
		allowedPaths: Array.isArray(json.allowedPaths) ? (json.allowedPaths as string[]) : [],
	};
	return deduplicateRules(rules);
}

export function toClaudePermissions(
	rules: PermissionRules,
	existing?: { allow?: string[]; ask?: string[]; deny?: string[] },
	allowOnly = true,
): {
	allow: string[];
	ask: string[];
	deny: string[];
} {
	const existingAllowNonPrefix = (existing?.allow ?? []).filter(r => typeof r === "string" && !isClaudePrefixRule(r));
	const existingAskNonPrefix = (existing?.ask ?? []).filter(r => typeof r === "string" && !isClaudePrefixRule(r));
	const existingDenyNonPrefix = (existing?.deny ?? []).filter(r => typeof r === "string" && !isClaudePrefixRule(r));

	const translatedAllow = rules.allow.map(formatClaudePrefix);
	const translatedAsk = allowOnly ? [] : rules.ask.map(formatClaudePrefix);
	const translatedDeny = allowOnly ? [] : rules.deny.map(formatClaudePrefix);

	const allow = [...new Set([...existingAllowNonPrefix, ...translatedAllow])];
	const ask = [...new Set([...existingAskNonPrefix, ...translatedAsk])];
	const deny = [...new Set([...existingDenyNonPrefix, ...translatedDeny])];

	return { allow, ask, deny };
}

export function toDevinPermissions(
	rules: PermissionRules,
	existing?: { allow?: string[]; ask?: string[]; deny?: string[] },
	allowOnly = true,
): {
	allow: string[];
	ask: string[];
	deny: string[];
} {
	const existingAllowNonPrefix = (existing?.allow ?? []).filter(r => typeof r === "string" && !isDevinPrefixRule(r));
	const existingAskNonPrefix = (existing?.ask ?? []).filter(r => typeof r === "string" && !isDevinPrefixRule(r));
	const existingDenyNonPrefix = (existing?.deny ?? []).filter(r => typeof r === "string" && !isDevinPrefixRule(r));

	const translatedAllow = rules.allow.map(formatDevinPrefix);
	const translatedAsk = allowOnly ? [] : rules.ask.map(formatDevinPrefix);
	const translatedDeny = allowOnly ? [] : rules.deny.map(formatDevinPrefix);

	const allow = [...new Set([...existingAllowNonPrefix, ...translatedAllow])];
	const ask = [...new Set([...existingAskNonPrefix, ...translatedAsk])];
	const deny = [...new Set([...existingDenyNonPrefix, ...translatedDeny])];

	return { allow, ask, deny };
}

export function deduplicateRules(rules: PermissionRules): PermissionRules {
	return {
		allow: [...new Set(rules.allow ?? [])],
		ask: [...new Set(rules.ask ?? [])],
		deny: [...new Set(rules.deny ?? [])],
		allowOutside: [...new Set(rules.allowOutside ?? [])],
		allowedPaths: [...new Set(rules.allowedPaths ?? [])],
	};
}
