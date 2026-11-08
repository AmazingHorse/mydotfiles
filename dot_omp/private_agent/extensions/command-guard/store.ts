import * as fs from "node:fs";
import * as path from "node:path";
import {
	deduplicateRules,
	fromClaudePermissions,
	fromDevinPermissions,
	fromOmpJson,
	toClaudePermissions,
	toDevinPermissions,
} from "./adapters.ts";
import type { PermissionLevel, PermissionRules } from "./types.ts";

export type ScopeName = "projectLocal" | "project" | "user" | "defaults";

export type ScopeCacheEntry = {
	mtimes: Record<string, number>;
	mergedRules: PermissionRules;
	lastSyncedHash: string;
	lastSyncedRules?: PermissionRules;
};

const scopeCache = new Map<string, ScopeCacheEntry>();
const mirrorInFlight = new Map<string, Promise<void>>();

export function clearScopeCache(): void {
	scopeCache.clear();
	mirrorInFlight.clear();
}

export function emptyRules(): PermissionRules {
	return {
		allow: [],
		ask: [],
		deny: [],
		allowOutside: [],
		allowedPaths: [],
		readRules: [],
		writeRules: [],
		mcpRules: [],
	};
}

function cloneRules(rules: PermissionRules): PermissionRules {
	return {
		allow: [...rules.allow],
		ask: [...rules.ask],
		deny: [...rules.deny],
		allowOutside: [...(rules.allowOutside ?? [])],
		allowedPaths: [...(rules.allowedPaths ?? [])],
		readRules: [...(rules.readRules ?? [])],
		writeRules: [...(rules.writeRules ?? [])],
		mcpRules: [...(rules.mcpRules ?? [])],
	};
}

function hashRules(rules: PermissionRules): string {
	return JSON.stringify([
		(rules.allow ?? []).slice().sort(),
		(rules.ask ?? []).slice().sort(),
		(rules.deny ?? []).slice().sort(),
		(rules.allowOutside ?? []).slice().sort(),
		(rules.allowedPaths ?? []).slice().sort(),
		(rules.readRules ?? []).slice().sort(),
		(rules.writeRules ?? []).slice().sort(),
		(rules.mcpRules ?? []).slice().sort(),
	]);
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

export type ScopeFiles = {
	claude?: string;
	devin?: string;
	omp: string;
};

export function getScopeFiles(scope: ScopeName, cwd: string, home: string): ScopeFiles {
	switch (scope) {
		case "projectLocal":
			return {
				claude: path.join(cwd, ".claude", "settings.local.json"),
				devin: path.join(cwd, ".devin", "config.local.json"),
				omp: projectLocalPath(cwd),
			};
		case "project":
			return {
				claude: path.join(cwd, ".claude", "settings.json"),
				devin: path.join(cwd, ".devin", "config.json"),
				omp: projectPath(cwd),
			};
		case "user": {
			const devinUser =
				process.platform === "win32"
					? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "devin", "config.json")
					: path.join(home, ".config", "devin", "config.json");
			return {
				claude: path.join(home, ".claude", "settings.json"),
				devin: devinUser,
				omp: userPath(home),
			};
		}
		case "defaults":
			return {
				omp: defaultsPath(home),
			};
	}
}

function getFileMtime(filePath: string): number {
	try {
		return fs.statSync(filePath, { throwIfNoEntry: false })?.mtimeMs ?? -1;
	} catch {
		return -1;
	}
}

export function readRulesFile(filePath: string): PermissionRules {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyRules();
		return fromOmpJson(parsed as Record<string, unknown>);
	} catch {
		return emptyRules();
	}
}

function readHarnessRules(harness: "claude" | "devin" | "omp", filePath: string): PermissionRules {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyRules();
		const record = parsed as Record<string, unknown>;

		if (harness === "claude") {
			const perms = (record.permissions && typeof record.permissions === "object"
				? record.permissions
				: {}) as { allow?: string[]; ask?: string[]; deny?: string[] };
			return fromClaudePermissions(perms);
		}
		if (harness === "devin") {
			const perms = (record.permissions && typeof record.permissions === "object"
				? record.permissions
				: {}) as { allow?: string[]; ask?: string[]; deny?: string[] };
			return fromDevinPermissions(perms);
		}
		return fromOmpJson(record);
	} catch {
		return emptyRules();
	}
}

function unionRules(rulesList: PermissionRules[]): PermissionRules {
	const merged: PermissionRules = emptyRules();
	for (const r of rulesList) {
		merged.allow.push(...r.allow);
		merged.ask.push(...r.ask);
		merged.deny.push(...r.deny);
		merged.allowOutside!.push(...(r.allowOutside ?? []));
		merged.allowedPaths!.push(...(r.allowedPaths ?? []));
		merged.readRules!.push(...(r.readRules ?? []));
		merged.writeRules!.push(...(r.writeRules ?? []));
		merged.mcpRules!.push(...(r.mcpRules ?? []));
	}
	const deduped = deduplicateRules(merged);
	// Deny takes precedence
	deduped.allow = deduped.allow.filter(a => !deduped.deny.includes(a));
	deduped.ask = deduped.ask.filter(a => !deduped.deny.includes(a));
	return deduped;
}

export async function flushPendingMirrors(): Promise<void> {
	const inFlight = [...mirrorInFlight.values()];
	if (inFlight.length > 0) {
		await Promise.all(inFlight);
	}
}

export function scheduleAsyncMirror(
	scope: ScopeName,
	cwd: string,
	home: string,
	rules: PermissionRules,
): Promise<void> {
	if (scope === "defaults" || scope === "project") return Promise.resolve();

	const cacheKey = `${scope}:${cwd}:${home}`;
	const existingPromise = mirrorInFlight.get(cacheKey);
	if (existingPromise) return existingPromise;

	const promise = (async () => {
		try {
			const files = getScopeFiles(scope, cwd, home);

			const writeHarnessFile = async (
				filePath: string,
				updater: (record: Record<string, unknown>) => void,
				mode?: number,
			) => {
				await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
				let record: Record<string, unknown> = {};
				let existingMode = mode;
				try {
					const st = await fs.promises.stat(filePath);
					existingMode = st.mode & 0o777;
					const text = await Bun.file(filePath).text();
					const parsed: unknown = JSON.parse(text);
					if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
						record = parsed as Record<string, unknown>;
					}
				} catch {
					// start fresh
				}

				updater(record);

				const content = JSON.stringify(record, null, 2) + "\n";
				const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
				await Bun.write(tmpFile, content);
				if (existingMode !== undefined) {
					await fs.promises.chmod(tmpFile, existingMode);
				}
				await fs.promises.rename(tmpFile, filePath);

				const newMtime = getFileMtime(filePath);
				const entry = scopeCache.get(cacheKey);
				if (entry) {
					entry.mtimes[filePath] = newMtime;
				}
			};

			const promises: Array<Promise<void>> = [];
			if (files.claude) {
				promises.push(
					writeHarnessFile(files.claude, rec => {
						const existingPerms =
							typeof rec.permissions === "object" && rec.permissions !== null
								? (rec.permissions as { allow?: string[]; ask?: string[]; deny?: string[] })
								: undefined;
						rec.permissions = toClaudePermissions(rules, existingPerms, true);
					}),
				);
			}
			if (files.devin) {
				promises.push(
					writeHarnessFile(
						files.devin,
						rec => {
							if (scope === "user" && rec.version === undefined) {
								rec.version = 1;
							}
							const existingPerms =
								typeof rec.permissions === "object" && rec.permissions !== null
									? (rec.permissions as { allow?: string[]; ask?: string[]; deny?: string[] })
									: undefined;
							rec.permissions = toDevinPermissions(rules, existingPerms, true);
						},
						0o600,
					),
				);
			}
			if (files.omp) {
				promises.push(
					writeHarnessFile(files.omp, rec => {
						rec.allow = rules.allow;
						rec.ask = rules.ask;
						rec.deny = rules.deny;
						rec.allowOutside = rules.allowOutside ?? [];
						rec.allowedPaths = rules.allowedPaths ?? [];
						if (rules.readRules && rules.readRules.length > 0) rec.readRules = rules.readRules;
						if (rules.writeRules && rules.writeRules.length > 0) rec.writeRules = rules.writeRules;
						if (rules.mcpRules && rules.mcpRules.length > 0) rec.mcpRules = rules.mcpRules;
					}),
				);
			}

			await Promise.all(promises);
		} finally {
			mirrorInFlight.delete(cacheKey);
		}
	})();

	mirrorInFlight.set(cacheKey, promise);
	return promise;
}

export type ScopeOptions = {
	mirror?: boolean;
};

export function getScopeRules(
	scope: ScopeName,
	cwd: string,
	home: string,
	options: ScopeOptions = {},
): PermissionRules {
	const shouldMirror = options.mirror !== false;
	const cacheKey = `${scope}:${cwd}:${home}`;
	const files = getScopeFiles(scope, cwd, home);
	const targetFiles: Array<{ harness: "claude" | "devin" | "omp"; path: string }> = [];
	if (files.claude) targetFiles.push({ harness: "claude", path: files.claude });
	if (files.devin) targetFiles.push({ harness: "devin", path: files.devin });
	targetFiles.push({ harness: "omp", path: files.omp });

	let entry = scopeCache.get(cacheKey);
	if (!entry) {
		entry = {
			mtimes: {},
			mergedRules: emptyRules(),
			lastSyncedHash: "",
		};
		scopeCache.set(cacheKey, entry);
	}

	const currentMtimes: Record<string, number> = {};
	let anyChanged = false;
	const changedHarnesses: Array<"claude" | "devin" | "omp"> = [];

	for (const f of targetFiles) {
		const mtime = getFileMtime(f.path);
		currentMtimes[f.path] = mtime;
		if (entry.mtimes[f.path] !== mtime) {
			anyChanged = true;
			if (mtime !== -1) {
				changedHarnesses.push(f.harness);
			}
		}
	}

	if (!anyChanged && entry.lastSyncedHash.length > 0) {
		return cloneRules(entry.mergedRules);
	}

	// Conflict / deletion semantics:
	if (entry.lastSyncedRules && changedHarnesses.length === 1) {
		const changed = changedHarnesses[0];
		const changedFile = targetFiles.find(t => t.harness === changed)!;
		const authoritativeRules = readHarnessRules(changed, changedFile.path);

		const updated = deduplicateRules({
			...entry.lastSyncedRules,
			allow: authoritativeRules.allow,
			ask: authoritativeRules.ask,
			deny: authoritativeRules.deny,
			allowedPaths: authoritativeRules.allowedPaths?.length
				? authoritativeRules.allowedPaths
				: entry.lastSyncedRules.allowedPaths,
			readRules: authoritativeRules.readRules?.length
				? authoritativeRules.readRules
				: entry.lastSyncedRules.readRules,
			writeRules: authoritativeRules.writeRules?.length
				? authoritativeRules.writeRules
				: entry.lastSyncedRules.writeRules,
			mcpRules: authoritativeRules.mcpRules?.length
				? authoritativeRules.mcpRules
				: entry.lastSyncedRules.mcpRules,
		});

		entry.mergedRules = updated;
		entry.lastSyncedRules = cloneRules(updated);
		entry.lastSyncedHash = hashRules(updated);
		entry.mtimes = currentMtimes;

		if (shouldMirror && scope !== "defaults") {
			scheduleAsyncMirror(scope, cwd, home, updated);
		}
		return cloneRules(entry.mergedRules);
	}

	// Multiple files changed or initial load:
	const loadedRules: PermissionRules[] = [];
	for (const f of targetFiles) {
		if (currentMtimes[f.path] !== -1) {
			loadedRules.push(readHarnessRules(f.harness, f.path));
		}
	}

	const merged = loadedRules.length > 0 ? unionRules(loadedRules) : emptyRules();
	entry.mergedRules = merged;
	entry.lastSyncedRules = cloneRules(merged);
	entry.lastSyncedHash = hashRules(merged);
	entry.mtimes = currentMtimes;

	// Check if any peer file is missing or out of sync
	if (shouldMirror && scope !== "defaults" && loadedRules.length > 0) {
		const anyPeerMissing = targetFiles.some(f => currentMtimes[f.path] === -1);
		if (anyPeerMissing || changedHarnesses.length > 0) {
			scheduleAsyncMirror(scope, cwd, home, merged);
		}
	}

	return cloneRules(entry.mergedRules);
}

export function loadPermissionLevels(
	cwd: string,
	home: string,
	sessionAllow: ReadonlySet<string> = new Set(),
	sessionAllowOutside: ReadonlySet<string> = new Set(),
	sessionAllowedPaths: ReadonlySet<string> = new Set(),
	options: ScopeOptions = {},
): PermissionLevel[] {
	const projectRules = getScopeRules("project", cwd, home, options);
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
		{ name: "projectLocal", rules: getScopeRules("projectLocal", cwd, home, options) },
		{
			name: "project",
			rules: {
				...projectRules,
				allowOutside: [],
				allowedPaths: [],
			},
		},
		{ name: "user", rules: getScopeRules("user", cwd, home, options) },
		{ name: "defaults", rules: getScopeRules("defaults", cwd, home, options) },
	];
}

const BLOCKED_SAVE_PREFIXES: Record<string, true> = {
	continue: true,
	break: true,
	read: true,
	return: true,
	exit: true,
	local: true,
	export: true,
	set: true,
	true: true,
	false: true,
	":": true,
};

export function saveRule(
	scope: ScopeName,
	category: "allow" | "ask" | "deny" | "allowOutside",
	prefix: string,
	cwd: string,
	home: string,
): Promise<void> {
	if (scope === "project" || BLOCKED_SAVE_PREFIXES[prefix.trim()]) {
		return Promise.resolve();
	}
	const current = getScopeRules(scope, cwd, home);
	const updated = cloneRules(current);

	if (category === "allowOutside") {
		updated.allowOutside = [...new Set([...(updated.allowOutside ?? []), prefix])];
	} else {
		// Remove from other categories
		updated.allow = updated.allow.filter(r => r !== prefix);
		updated.ask = updated.ask.filter(r => r !== prefix);
		updated.deny = updated.deny.filter(r => r !== prefix);
		updated[category].push(prefix);
	}

	const cacheKey = `${scope}:${cwd}:${home}`;
	const entry = scopeCache.get(cacheKey);
	if (entry) {
		entry.mergedRules = updated;
		entry.lastSyncedRules = cloneRules(updated);
		entry.lastSyncedHash = hashRules(updated);
	}

	return scheduleAsyncMirror(scope, cwd, home, updated);
}

export function savePathRule(
	scope: ScopeName,
	targetPath: string,
	cwd: string,
	home: string,
): Promise<void> {
	const current = getScopeRules(scope, cwd, home);
	const updated = cloneRules(current);
	updated.allowedPaths = [...new Set([...(updated.allowedPaths ?? []), targetPath])];
	updated.writeRules = [...new Set([...(updated.writeRules ?? []), targetPath])];

	const cacheKey = `${scope}:${cwd}:${home}`;
	const entry = scopeCache.get(cacheKey);
	if (entry) {
		entry.mergedRules = updated;
		entry.lastSyncedRules = cloneRules(updated);
		entry.lastSyncedHash = hashRules(updated);
	}

	return scheduleAsyncMirror(scope, cwd, home, updated);
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
