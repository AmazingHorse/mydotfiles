import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	commandPrefix,
	decideSegment,
	isProtectedPath,
	matchesPrefix,
	splitShellSegments,
	type PermissionLevel,
	type PermissionRules,
} from "../dot_omp/private_agent/extensions/bootstrap-guard.ts";

const CWD = "/work/repo";
const HOME = "/home/u";

const defaultsPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"dot_omp",
	"private_agent",
	"permissions.defaults.json",
);
const defaultsRules = JSON.parse(readFileSync(defaultsPath, "utf8")) as PermissionRules;
const defaultsLevel: PermissionLevel = { name: "defaults", rules: defaultsRules };
const emptyRules: PermissionRules = { allow: [], ask: [], deny: [] };

function level(name: PermissionLevel["name"], rules: Partial<PermissionRules>): PermissionLevel {
	return { name, rules: { ...emptyRules, ...rules } };
}

function words(command: string): string[] {
	const { segments, complex } = splitShellSegments(command);
	expect(complex).toBe(false);
	expect(segments).toHaveLength(1);
	return segments[0];
}

describe("splitShellSegments", () => {
	test("splits on && and |", () => {
		expect(splitShellSegments("git status && npm test | head").segments).toEqual([
			["git", "status"],
			["npm", "test"],
			["head"],
		]);
	});

	test("double-quoted operators do not split", () => {
		expect(splitShellSegments('echo "a && b"').segments).toEqual([["echo", "a && b"]]);
	});

	test("single-quoted operators do not split", () => {
		expect(splitShellSegments("echo 'x;y'").segments).toEqual([["echo", "x;y"]]);
	});

	test("drops leading env assignments", () => {
		expect(words("FOO=1 npm test")).toEqual(["npm", "test"]);
	});

	test("command substitution marks complex", () => {
		expect(splitShellSegments("cat <<<x $(whoami)").complex).toBe(true);
	});

	test("redirection target stays a word", () => {
		expect(words("ls > /etc/x")).toEqual(["ls", "/etc/x"]);
	});

	test("fd duplication is dropped", () => {
		const segmentWords = words("cmd 2>&1");
		expect(segmentWords).toEqual(["cmd"]);
		expect(segmentWords).not.toContain("2>&1");
		expect(segmentWords).not.toContain("&1");
	});
});

describe("commandPrefix", () => {
	test("two words for subcommand tools", () => {
		expect(commandPrefix(["git", "push", "origin", "main"])).toBe("git push");
	});

	test("three words for run-style prefixes", () => {
		expect(commandPrefix(["npm", "run", "build", "--", "--x"])).toBe("npm run build");
	});

	test("one word for plain tools", () => {
		expect(commandPrefix(["ls", "-la"])).toBe("ls");
	});

	test("three words for python -m", () => {
		expect(commandPrefix(["python", "-m", "pytest", "-q"])).toBe("python -m pytest");
	});
});

describe("matchesPrefix", () => {
	test("word-boundary match rejects gitk", () => {
		expect(matchesPrefix(["gitk", "status"], "git")).toBe(false);
	});

	test("prefix matches leading words", () => {
		expect(matchesPrefix(["git", "status", "-s"], "git status")).toBe(true);
	});
});

describe("isProtectedPath", () => {
	test("identifies protected agent configs and permissions", () => {
		expect(isProtectedPath(`${HOME}/.omp/agent/permissions.json`, CWD, HOME)).toBe(true);
		expect(isProtectedPath(`${HOME}/.omp/agent/extensions/bootstrap-guard.ts`, CWD, HOME)).toBe(true);
		expect(isProtectedPath(`${CWD}/.omp/permissions.json`, CWD, HOME)).toBe(true);
		expect(isProtectedPath(`${CWD}/.omp/permissions.local.json`, CWD, HOME)).toBe(true);

		expect(isProtectedPath(`${HOME}/.omp/scratch/x`, CWD, HOME)).toBe(false);
		expect(isProtectedPath(`${CWD}/src/index.ts`, CWD, HOME)).toBe(false);
		expect(isProtectedPath(`${CWD}/package.json`, CWD, HOME)).toBe(false);
	});
});
describe("decideSegment with defaults", () => {
	const decide = (command: string) => decideSegment(words(command), [defaultsLevel], CWD, HOME);

	test("allowed read-only commands", () => {
		expect(decide("git status")).toEqual({ kind: "allow" });
		expect(decide("ls /tmp/x")).toEqual({ kind: "allow" });
		expect(decide("bash -n script.sh")).toEqual({ kind: "allow" });
	});

	test("git branch allowed for inspection but gated for deletion", () => {
		expect(decide("git branch")).toEqual({ kind: "allow" });
		expect(decide("git branch -a")).toEqual({ kind: "allow" });
		expect(decide("git branch --list")).toEqual({ kind: "allow" });
		expect(decide("git branch -D feature")).toEqual({ kind: "ask", rule: "git branch -D", persistable: true });
		expect(decide("git branch -d feature")).toEqual({ kind: "ask", rule: "git branch -d", persistable: true });
		expect(decide("git branch --delete feature")).toEqual({ kind: "ask", rule: "git branch --delete", persistable: true });
		expect(decide("git branch -m old new")).toEqual({ kind: "ask", rule: "git branch -m", persistable: true });
	});

	test("ask rules are persistable", () => {
		expect(decide("git push")).toEqual({ kind: "ask", rule: "git push", persistable: true });
		expect(decide("rm -rf build")).toEqual({ kind: "ask", rule: "rm", persistable: true });
	});

	test("unmatched commands", () => {
		expect(decide("make")).toEqual({ kind: "unmatched", persistable: true });
	});

	test("path escapes are non-persistable", () => {
		expect(decide("cat ../x")).toEqual({
			kind: "ask",
			rule: "path outside workspace: ../x",
			persistable: false,
		});
		expect(decide("npm test --config=/etc/npmrc")).toEqual({
			kind: "ask",
			rule: "path outside workspace: /etc/npmrc",
			persistable: false,
		});
		expect(decide("npm test --reporter=spec")).toEqual({ kind: "allow" });
		expect(decide("ls /etc")).toEqual({
			kind: "ask",
			rule: "path outside workspace: /etc",
			persistable: false,
		});
	});

	test("self-escalation attempts to agent config are non-persistable asks", () => {
		expect(decide("echo x > ~/.omp/agent/permissions.json")).toEqual({
			kind: "ask",
			rule: "protected agent config: ~/.omp/agent/permissions.json",
			persistable: false,
		});
		expect(decide("cat .omp/permissions.local.json")).toEqual({
			kind: "ask",
			rule: "protected agent config: .omp/permissions.local.json",
			persistable: false,
		});
		expect(decide("ls ~/.omp/scratch/x")).toEqual({ kind: "allow" });
	});
	test("grep and rg are allowed outside workspace on non-protected paths", () => {
		expect(decide("grep -rn pattern /usr/share/doc")).toEqual({ kind: "allow" });
		expect(decide("rg pattern /usr/share/doc")).toEqual({ kind: "allow" });
	});

	test("grep on protected agent config is still a non-persistable ask", () => {
		expect(decide("grep pattern ~/.omp/agent/permissions.json")).toEqual({
			kind: "ask",
			rule: "protected agent config: ~/.omp/agent/permissions.json",
			persistable: false,
		});
	});
	test("dangerous flags are non-persistable", () => {
		expect(decide("rg foo --pre cat")).toEqual({
			kind: "ask",
			rule: "dangerous flag: --pre",
			persistable: false,
		});
		expect(decide("git -c x=y status")).toEqual({
			kind: "ask",
			rule: "git -c",
			persistable: false,
		});
		expect(decide("find . -delete")).toEqual({
			kind: "ask",
			rule: "find -exec/-delete",
			persistable: false,
		});
	});

	test("shell -c is non-persistable", () => {
		expect(decide('bash -c "ls"')).toEqual({
			kind: "ask",
			rule: "shell -c: bash",
			persistable: false,
		});
	});
});

describe("decideSegment precedence", () => {
	test("user allow beats defaults ask", () => {
		const levels = [level("user", { allow: ["git push"] }), defaultsLevel];
		expect(decideSegment(words("git push"), levels, CWD, HOME)).toEqual({ kind: "allow" });
	});

	test("longer same-level ask beats shorter allow", () => {
		const levels = [level("defaults", { allow: ["git"], ask: ["git push"] })];
		expect(decideSegment(words("git push"), levels, CWD, HOME)).toEqual({
			kind: "ask",
			rule: "git push",
			persistable: true,
		});
	});

	test("same-level allow/ask tie resolves to allow", () => {
		const levels = [level("defaults", { allow: ["git push"], ask: ["git push"] })];
		expect(decideSegment(words("git push"), levels, CWD, HOME)).toEqual({ kind: "allow" });
	});

	test("deny at any level beats session allow", () => {
		const levels = [level("session", { allow: ["npm test"] }), level("defaults", { deny: ["npm"] })];
		expect(decideSegment(words("npm test"), levels, CWD, HOME)).toEqual({ kind: "deny", rule: "npm" });
	});
	test("project level allow is ignored; falls back to defaults ask", () => {
		const levels = [
			level("project", { allow: ["curl"] }),
			defaultsLevel,
		];
		expect(decideSegment(words("curl https://example.com"), levels, CWD, HOME)).toEqual({
			kind: "ask",
			rule: "curl",
			persistable: true,
		});
	});
	test("allowedPaths permits otherwise unallowed outside paths", () => {
		const levels = [
			level("projectLocal", { allowedPaths: ["/usr/local/share"] }),
			defaultsLevel,
		];
		expect(decideSegment(words("ls /usr/local/share"), levels, CWD, HOME)).toEqual({ kind: "allow" });
	});

	test("allowOutside permits command to access outside paths", () => {
		const levels = [
			level("session", { allow: ["cat"], allowOutside: ["cat"] }),
			defaultsLevel,
		];
		expect(decideSegment(words("cat /usr/share/doc/README"), levels, CWD, HOME)).toEqual({ kind: "allow" });
	});
});
