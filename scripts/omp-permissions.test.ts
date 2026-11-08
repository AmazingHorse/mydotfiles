import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	fromClaudePermissions,
	fromDevinPermissions,
	matchesGlob,
	toClaudePermissions,
	toDevinPermissions,
} from "../dot_omp/private_agent/extensions/command-guard/adapters.ts";
import {
	clearSessionState,
	commandPrefix,
	decideSegment,
	flushPendingMirrors,
	evaluateCommand,
	isProtectedPath,
	loadPermissionLevels,
	matchesPrefix,
	parseShellCommand,
	saveRule,
	splitShellSegments,
	workspaceRoots,
	type PermissionRules,
} from "../dot_omp/private_agent/extensions/command-guard/index.ts";
import {
	clearScopeCache,
	getScopeRules,
} from "../dot_omp/private_agent/extensions/command-guard/store.ts";

const CWD = "/work/repo";
const HOME = "/home/u";

const defaultsPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"dot_omp",
	"private_agent",
	"permissions.defaults.json",
);
const defaultsRules = (await Bun.file(defaultsPath).json()) as PermissionRules;
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
		expect(isProtectedPath(`${HOME}/.omp/agent/extensions/command-guard/index.ts`, CWD, HOME)).toBe(true);
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
	test("project level allow is permitted; allows command", () => {
		const levels = [
			level("project", { allow: ["curl"] }),
			defaultsLevel,
		];
		expect(decideSegment(words("curl https://example.com"), levels, CWD, HOME)).toEqual({
			kind: "allow",
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

describe("command-guard heredocs, templates, and normalizer", () => {
	const decide = (command: string) => {
		const parsed = parseShellCommand(command);
		for (const seg of parsed.parsedSegments) {
			const d = decideSegment(seg.words, [defaultsLevel], CWD, HOME);
			if (d.kind !== "allow") return d;
		}
		return { kind: "allow" };
	};

	test("quoted heredocs with chezmoi templates ignore template content", () => {
		const cmd = `cat > .scratch/test.toml.tmpl << 'EOF'
{{- $isEphemeral := or (env "CODESPACES") (not stdinIsATTY) -}}
[data]
gitName = {{ $gitName | quote }}
EOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["cat", ".scratch/test.toml.tmpl"]]);
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});

	test("quoted heredocs with Windows CRLF line endings ignore body content", () => {
		const cmd = "cat > .scratch/crlf.toml << 'EOF'\r\n[data.toolsets]\r\nrust = false\r\nEOF\r\ncat .scratch/crlf.toml";
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([
			["cat", ".scratch/crlf.toml"],
			["cat", ".scratch/crlf.toml"],
		]);
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});

	test("quoted heredocs with pipes parse pipe segments without body tokens", () => {
		const cmd = `cat << "EOF" | grep foo
some | text | with | pipes
EOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["cat"], ["grep", "foo"]]);
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});

	test("unquoted heredoc without expansions is not complex", () => {
		const cmd = `cat << EOF
plain text
EOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["cat"]]);
	});

	test("unquoted heredoc with command substitution flags complex", () => {
		const cmd = `cat << EOF
$(whoami)
EOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(true);
	});

	test("heredoc redirecting outside workspace is blocked", () => {
		const cmd = `cat > /etc/passwd << 'EOF'
root:x:0:0:root:/root:/bin/bash
EOF`;
		expect(decide(cmd)).toEqual({
			kind: "ask",
			rule: "path outside workspace: /etc/passwd",
			persistable: false,
		});
	});

	test("inline chezmoi template rendering is allowed", () => {
		const cmd = "chezmoi execute-template --source . '{{ includeTemplate \"agent-core.md\" . }}'";
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});

	test("inline template with $HOME does not trigger path outside workspace", () => {
		const cmd = "chezmoi execute-template '{{ $HOME }}'";
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});

	test("global flag skipping normalizes command signatures", () => {
		expect(commandPrefix(words("chezmoi --source . data"))).toBe("chezmoi data");
		expect(decide("chezmoi --source . data")).toEqual({ kind: "allow" });

		expect(commandPrefix(words("git -C subrepo status"))).toBe("git status");
		expect(decide("git -C subrepo status")).toEqual({ kind: "allow" });

		expect(commandPrefix(words("just -g doctor"))).toBe("just doctor");
		expect(decide("just -g doctor")).toEqual({ kind: "allow" });
	});

	test("git -c remains gated despite flag skipping", () => {
		expect(decide("git -c core.sshCommand=evil status")).toEqual({
			kind: "ask",
			rule: "git -c",
			persistable: false,
		});
	});

	test("comments are ignored", () => {
		const cmd = `# check repository status
git status`;
		const res = parseShellCommand(cmd);
		expect(res.segments).toEqual([["git", "status"]]);
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});

	test("flow keywords are stripped from segment heads", () => {
		const cmd = `if git status; then echo ok; fi`;
		const res = parseShellCommand(cmd);
		expect(res.segments).toEqual([["git", "status"], ["echo", "ok"]]);
		expect(decide(cmd)).toEqual({ kind: "allow" });
	});
});

describe("Heredoc & subshell lexer hardening (Plan 9 Workstream 4)", () => {
	test("python3 heredoc with dash has complex: false and prefix 'python3'", () => {
		const cmd = `python3 - << 'EOF'\nimport os\nprint("hello")\nEOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["python3", "-"]]);
		expect(commandPrefix(res.parsedSegments[0].words)).toBe("python3");
	});

	test("backslash-escaped delimiter python3 << \\EOF quotes body", () => {
		const cmd = `python3 << \\EOF\nprint("$HOME")\nEOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["python3"]]);
	});

	test("heredoc followed by && parses logical segments", () => {
		const cmd = `python3 - << 'EOF' && echo ok\nprint("a && b")\nEOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["python3", "-"], ["echo", "ok"]]);
	});

	test("heredoc followed by pipe on newline parses downstream segment", () => {
		const cmd = `python3 - << 'EOF' |\nprint("a | b")\nEOF\ngrep a`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["python3", "-"], ["grep", "a"]]);
	});

	test("double quotes inside subshell do not leak inner lines into shell segments", () => {
		const cmd = `python3 -c "$(cat << 'EOF'\nprint("double quotes && rm -rf /")\nEOF\n)"`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(true);
		expect(res.segments.length).toBe(1);
		expect(res.segments[0][0]).toBe("python3");
		expect(res.segments[0][1]).toBe("-c");
		expect(res.segments.some(seg => seg.includes("rm"))).toBe(false);
	});

	test("subshell closing parenthesis after heredoc does not emit stray ')' segment", () => {
		const cmd = `x=$(python3 << 'EOF'\nprint(1)\nEOF\n)`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(true);
		expect(res.segments.some(seg => seg.includes(")"))).toBe(false);
		expect(res.segments).toEqual([]);
	});
	test("closing EOF without trailing newline consumes body completely", () => {
		const cmd = `cat << 'EOF'\nhello\nEOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["cat"]]);
	});

	test("FD-prefixed heredoc 0<<EOF strips file descriptor number", () => {
		const cmd = `cat 0<<EOF\ninput\nEOF`;
		const res = parseShellCommand(cmd);
		expect(res.complex).toBe(false);
		expect(res.segments).toEqual([["cat"]]);
	});

	test("python3 script prefix normalizes to python3, not subcommand", () => {
		expect(commandPrefix(words("python3 script.py"))).toBe("python3");
		expect(commandPrefix(words("python3 -m unittest"))).toBe("python3 -m unittest");
		expect(commandPrefix(words("python script.py"))).toBe("python");
		expect(commandPrefix(words("python -m unittest"))).toBe("python -m unittest");
	});
});

describe("Cross-Harness Adapters & Bun.Glob (Plan 9 Workstreams 1 & 2)", () => {
	test("Bun.Glob matches Read(**/.env) and Edit(src/**)", () => {
		expect(matchesGlob("**/.env", "deep/sub/dir/.env")).toBe(true);
		expect(matchesGlob("**/.env", "deep/sub/dir/not-env")).toBe(false);
		expect(matchesGlob("src/**", "src/components/Button.tsx")).toBe(true);
		expect(matchesGlob("src/**", "docs/index.md")).toBe(false);
	});

	test("translates Claude Code command prefixes and allow Edit paths to internal rules", () => {
		const claude = {
			allow: [
				"Bash(git status *)",
				"Bash(pwd)",
				"Read(**/.env)",
				"Edit(src/**)",
				"mcp__sqlite__query",
			],
			ask: ["Bash(npm publish *)"],
			deny: ["Bash(rm -rf *)", "Read(**/.env)"],
		};
		const rules = fromClaudePermissions(claude);
		expect(rules.allow).toEqual(["git status", "pwd"]);
		expect(rules.allowedPaths).toEqual(["src/**"]);
		expect(rules.ask).toEqual(["npm publish"]);
		expect(rules.deny).toEqual(["rm -rf"]);
	});

	test("translates Devin CLI command prefixes and allow Write paths to internal rules", () => {
		const devin = {
			allow: [
				"Exec(git status)",
				"Read(**/.env)",
				"Write(src/**)",
				"mcp__sqlite__query",
			],
			ask: ["Exec(npm publish)"],
			deny: ["Exec(rm -rf)"],
		};
		const rules = fromDevinPermissions(devin);
		expect(rules.allow).toEqual(["git status"]);
		expect(rules.allowedPaths).toEqual(["src/**"]);
		expect(rules.ask).toEqual(["npm publish"]);
		expect(rules.deny).toEqual(["rm -rf"]);
	});

	test("toClaudePermissions preserves non-prefix entries and translates only command prefixes", () => {
		const existing = {
			allow: ["Read(docs/**)", "Fetch(api.github.com)"],
			ask: ["Edit(/etc/**)"],
			deny: ["Read(**/.env)", "mcp__dangerous__*"],
		};
		const rules: PermissionRules = {
			allow: ["git status", "pwd"],
			ask: ["npm publish"],
			deny: ["rm -rf"],
		};
		const claude = toClaudePermissions(rules, existing, true);
		expect(claude.allow).toContain("Read(docs/**)");
		expect(claude.allow).toContain("Fetch(api.github.com)");
		expect(claude.allow).toContain("Bash(git status *)");
		expect(claude.allow).toContain("Bash(pwd)");

		// ask and deny preserve original entries and do not inherit inverted rules
		expect(claude.ask).toEqual(["Edit(/etc/**)"]);
		expect(claude.deny).toEqual(["Read(**/.env)", "mcp__dangerous__*"]);
	});

	test("toDevinPermissions preserves non-prefix entries and translates only command prefixes", () => {
		const existing = {
			allow: ["Read(docs/**)", "WebFetch(https://*)"],
			ask: ["Write(/etc/**)"],
			deny: ["Read(**/.env)"],
		};
		const rules: PermissionRules = {
			allow: ["git status"],
			ask: ["npm publish"],
			deny: ["rm -rf"],
		};
		const devin = toDevinPermissions(rules, existing, true);
		expect(devin.allow).toContain("Read(docs/**)");
		expect(devin.allow).toContain("WebFetch(https://*)");
		expect(devin.allow).toContain("Exec(git status)");

		// ask and deny preserve original entries
		expect(devin.ask).toEqual(["Write(/etc/**)"]);
		expect(devin.deny).toEqual(["Read(**/.env)"]);
	});
	test("lazy mtime detection and async mirroring propagates single-file deletion", async () => {
		const testHome = join(tmpdir(), `test-home-${Date.now()}`);
		const tmpDir = join(testHome, "project");
		const claudeFile = join(tmpDir, ".claude", "settings.local.json");
		const devinFile = join(tmpDir, ".devin", "config.local.json");
		const ompFile = join(tmpDir, ".omp", "permissions.local.json");

		clearScopeCache();

		await Bun.write(
			claudeFile,
			JSON.stringify(
				{
					permissions: {
						allow: ["Bash(pytest *)", "Bash(ruff *)"],
						ask: [],
						deny: [],
					},
				},
				null,
				2,
			),
		);

		const rules1 = getScopeRules("projectLocal", tmpDir, testHome);
		expect(rules1.allow).toContain("pytest");
		expect(rules1.allow).toContain("ruff");

		await flushPendingMirrors();

		expect(await Bun.file(ompFile).exists()).toBe(true);
		expect(await Bun.file(devinFile).exists()).toBe(true);

		await Bun.write(
			claudeFile,
			JSON.stringify(
				{
					permissions: {
						allow: ["Bash(pytest *)"],
						ask: [],
						deny: [],
					},
				},
				null,
				2,
			),
		);

		const rules2 = getScopeRules("projectLocal", tmpDir, testHome);
		expect(rules2.allow).toContain("pytest");
		expect(rules2.allow).not.toContain("ruff");

		await flushPendingMirrors();

		const ompContent = await Bun.file(ompFile).json();
		expect(ompContent.allow).toContain("pytest");
		expect(ompContent.allow).not.toContain("ruff");
	});
});

describe("Double-Prompt Prevention & Subagent Session State (Plan 9 Workstream 3)", () => {
	test("decideSegment attaches unapprovedPrefix when command prefix is not allowed", () => {
		const levels = [
			level("session", { allow: ["git"] }),
			defaultsLevel,
		];
		const dec = decideSegment(words("mycustomcmd /opt/other/file"), levels, CWD, HOME);
		expect(dec.kind).toBe("ask");
		expect(dec.rule).toContain("path outside workspace");
		if (dec.kind === "ask") {
			expect(dec.unapprovedPrefix).toBe("mycustomcmd");
		}
	});

	test("decideSegment does not attach unapprovedPrefix when command prefix is already allowed", () => {
		const levels = [
			level("session", { allow: ["cat"] }),
			defaultsLevel,
		];
		const dec = decideSegment(words("cat /opt/other/file"), levels, CWD, HOME);
		expect(dec.kind).toBe("ask");
		if (dec.kind === "ask") {
			expect(dec.unapprovedPrefix).toBeUndefined();
		}
	});
});

describe("Worktrunk (wt) & Git Worktree Lifecycle (Plan 10)", () => {
	test("commandPrefix normalizes Worktrunk commands", () => {
		expect(commandPrefix(words("wt list"))).toBe("wt list");
		expect(commandPrefix(words("wt status"))).toBe("wt status");
		expect(commandPrefix(words("wt switch --create feat"))).toBe("wt switch");
		expect(commandPrefix(words("wt step copy-ignored"))).toBe("wt step copy-ignored");
		expect(commandPrefix(words("wt step diff"))).toBe("wt step diff");
		expect(commandPrefix(words("wt merge"))).toBe("wt merge");
		expect(commandPrefix(words("wt remove feat"))).toBe("wt remove");
	});

	test("permissions.defaults.json configures wt commands appropriately", () => {
		expect(defaultsRules.allow).toContain("wt list");
		expect(defaultsRules.allow).toContain("wt status");
		expect(defaultsRules.allow).toContain("wt step diff");
		expect(defaultsRules.allow).toContain("wt step copy-ignored");
		expect(defaultsRules.allow).toContain("wt config state");

		expect(defaultsRules.ask).toContain("wt merge");
		expect(defaultsRules.ask).toContain("wt remove");
		expect(defaultsRules.ask).toContain("doas");
	});

	test("saveRule rejects shell keywords and builtins", async () => {
		const testHome = join(tmpdir(), `test-save-reject-${Date.now()}`);
		const tmpDir = join(testHome, "project");
		clearScopeCache();

		await saveRule("projectLocal", "allow", "continue", tmpDir, testHome);
		await saveRule("projectLocal", "allow", "read", tmpDir, testHome);
		await saveRule("projectLocal", "allow", "return", tmpDir, testHome);
		await saveRule("projectLocal", "allow", ":", tmpDir, testHome);
		await flushPendingMirrors();

		const rules = getScopeRules("projectLocal", tmpDir, testHome);
		expect(rules.allow).not.toContain("continue");
		expect(rules.allow).not.toContain("read");
		expect(rules.allow).not.toContain("return");
		expect(rules.allow).not.toContain(":");
	});

	test("saveRule and scheduleAsyncMirror never write to project scope", async () => {
		const testHome = join(tmpdir(), `test-project-ro-${Date.now()}`);
		const tmpDir = join(testHome, "project");
		const projectOmpFile = join(tmpDir, ".omp", "permissions.json");
		clearScopeCache();

		await saveRule("project", "allow", "pytest", tmpDir, testHome);
		await flushPendingMirrors();

		expect(await Bun.file(projectOmpFile).exists()).toBe(false);
	});

	test("workspaceRoots recognizes git linked worktree and protects git hooks/config", async () => {
		const testHome = join(tmpdir(), `test-wt-home-${Date.now()}`);
		const tmpMain = join(testHome, "main-repo");
		const tmpWt = join(testHome, "wt-feature");
		const gitDirInMain = join(tmpMain, ".git");
		const worktreeGitDir = join(gitDirInMain, "worktrees", "my-feature");

		await Bun.write(join(tmpWt, ".git"), `gitdir: ${worktreeGitDir}\n`);
		await Bun.write(join(worktreeGitDir, "gitdir"), `${join(tmpWt, ".git")}\n`);
		await Bun.write(join(gitDirInMain, "config"), "[core]\n");
		await Bun.write(join(gitDirInMain, "hooks", "pre-commit"), "#!/bin/sh\n");

		const roots = workspaceRoots(tmpWt, testHome);
		expect(roots).toContain(tmpWt);
		expect(roots).toContain(tmpMain);

		expect(isProtectedPath(join(gitDirInMain, "hooks", "pre-commit"), tmpWt, testHome)).toBe(true);
		expect(isProtectedPath(join(gitDirInMain, "config"), tmpWt, testHome)).toBe(true);

		expect(isProtectedPath(join(tmpMain, "README.md"), tmpWt, testHome)).toBe(false);
	});
});

describe("PreToolUse hook & evaluateCommand (Plan 15 Phase 1)", () => {
	const hookPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"dot_omp",
		"private_agent",
		"extensions",
		"command-guard",
		"hook.ts",
	);

	test("evaluateCommand gives expected verdicts across allow, ask, deny, and unmatched", () => {
		const levels: PermissionLevel[] = [
			level("user", { deny: ["npm publish"] }),
			defaultsLevel,
		];

		expect(evaluateCommand("git status", CWD, HOME, levels).verdict).toBe("allow");
		expect(evaluateCommand("sudo ls", CWD, HOME, levels).verdict).toBe("ask");
		expect(evaluateCommand("npm publish", CWD, HOME, levels).verdict).toBe("deny");
		expect(evaluateCommand("bash -c 'echo 1'", CWD, HOME, levels).verdict).toBe("ask");
		expect(evaluateCommand("custom_unknown_bin", CWD, HOME, levels).verdict).toBe("unmatched");
	});

	test("hook subprocess handles Claude Code PreToolUse payload for ask", async () => {
		const proc = Bun.spawn(["bun", hookPath], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		proc.stdin.write(
			JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				tool_input: { command: "sudo ls" },
			}),
		);
		proc.stdin.end();
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.hookSpecificOutput?.permissionDecision).toBe("ask");
		expect(parsed.hookSpecificOutput?.permissionDecisionReason).toContain("sudo");
	});

	test("hook subprocess handles Devin CLI exec payload for ask with fallback block", async () => {
		const proc = Bun.spawn(["bun", hookPath], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		proc.stdin.write(
			JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "exec",
				tool_input: { command: "bash -c 'ls'" },
			}),
		);
		proc.stdin.end();
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("needs human approval");
	});

	test("hook subprocess produces no output and exits 0 for allowed commands", async () => {
		const proc = Bun.spawn(["bun", hookPath], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		proc.stdin.write(
			JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				tool_input: { command: "git status" },
			}),
		);
		proc.stdin.end();
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("");
	});

	test("hook subprocess fails open (exit 1, no stdout) on malformed stdin", async () => {
		const proc = Bun.spawn(["bun", hookPath], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});
		proc.stdin.write("not-valid-json-{{{");
		proc.stdin.end();
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(exitCode).toBe(1);
		expect(stdout.trim()).toBe("");
	});

	test("loadPermissionLevels with mirror: false performs no write side effects", async () => {
		const testHome = join(tmpdir(), `test-read-only-${Date.now()}`);
		const tmpDir = join(testHome, "project");
		const claudeFile = join(tmpDir, ".claude", "settings.local.json");
		const ompFile = join(tmpDir, ".omp", "permissions.local.json");

		clearScopeCache();
		await Bun.write(
			claudeFile,
			JSON.stringify({
				permissions: {
					allow: ["Bash(pytest *)"],
					ask: [],
					deny: [],
				},
			}),
		);

		// Load with mirror: false
		loadPermissionLevels(tmpDir, testHome, new Set(), new Set(), new Set(), { mirror: false });
		await flushPendingMirrors();

		// Peer file should NOT have been created by the read-only loader
		expect(await Bun.file(ompFile).exists()).toBe(false);
	});
});
