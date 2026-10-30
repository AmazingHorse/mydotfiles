import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePathWord } from "./rules.ts";
import type { PermissionLevel, PermissionRules } from "./types.ts";

export function emptyRules(): PermissionRules {
	return { allow: [], ask: [], deny: [], allowOutside: [], allowedPaths: [] };
}

export function readRulesFile(filePath: string): PermissionRules {
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

export function projectLocalPath(cwd: string): string {
	return path.join(cwd, ".omp", "permissions.local.json");
}

export function projectPath(cwd: string): string {
	return path.join(cwd, ".omp", "permissions.json");
}

export function userPath(home: string): string {
	return path.join(home, ".omp", "agent", "permissions.json");
}

export function defaultsPath(home: string): string {
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

export function appendRuleEntries(
	filePath: string,
	key: "allow" | "allowOutside" | "allowedPaths",
	entries: string[],
): void {
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
