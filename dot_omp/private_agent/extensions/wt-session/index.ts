/**
 * `wt-session` — worktree lifecycle commands for omp sessions.
 *
 * Companion to the dotfiles worktree setup:
 *   - omp spawns its own session worktrees natively (worktree.onStart/onExit in
 *     ~/.omp/agent/config.yml) on wt/<timestamp> branches.
 *   - claude/devin get the same lifecycle from the `_wt_agent_exec` shell
 *     wrapper (worktrunk `wt switch -x`), whose exit epilogue reads the
 *     `.policy-*` markers this extension writes.
 *
 * Commands:
 *   /wt-name <branch>   Rename the checked-out branch mid-session (agent/* and
 *                       wt/* names are placeholders; give work a real name).
 *   /wt-switch <branch> Check out a different existing branch in place inside
 *                       this worktree (`-c <name>` to create it first).
 *   /wt-pull [--copy]   Move another worktree's uncommitted changes into this
 *                       one (stash push + apply; default source: primary).
 *   /wt-merge [target]  Commit + merge this branch into the default branch
 *                       (wt merge --no-remove: stage, squash, rebase, verify
 *                       hooks, ff-merge). Worktree survives for the session.
 *   /wt-keep            Keep this worktree on session exit, no prompt.
 *   /wt-drop            Discard this worktree and its branch on session exit.
 *   /wt-status          Show branch, worktree root, commits ahead, dirty count.
 *
 * Keep/drop intent is a marker file at <git-common>/agent-bus/.policy-<worktree>
 * consumed by the shell epilogue; for omp-native worktrees worktree.onExit
 * governs instead (markers are harmless no-ops there).
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import * as fs from "bun:fs";
import * as path from "bun:path";

interface RepoInfo {
	root: string;
	gitDir: string;
	commonDir: string;
	branch: string;
	baseBranch: string;
	linked: boolean;
}

const BRANCH_REF_RE = /^[^\s~^:?*[\\]+$/;

function isValidBranchName(name: string): boolean {
	return BRANCH_REF_RE.test(name) && !name.startsWith("-") && !name.endsWith("/") && !name.includes("..");
}

async function gitInfo(
	exec: (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>,
): Promise<RepoInfo | null> {
	const root = (await exec("git", ["rev-parse", "--show-toplevel"])).stdout.trim();
	if (!root) return null;
	const gitDir = (await exec("git", ["rev-parse", "--path-format=absolute", "--git-dir"])).stdout.trim();
	const commonDir = (await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
	const branch = (await exec("git", ["branch", "--show-current"])).stdout.trim();
	const head = (await exec("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"])).stdout.trim();
	return {
		root,
		gitDir,
		commonDir,
		branch,
		baseBranch: head ? head.replace(/^[^/]+\//, "") : "main",
		linked: Boolean(gitDir && commonDir && gitDir !== commonDir),
	};
}

function policyPath(info: RepoInfo): string {
	return path.join(info.commonDir, "agent-bus", `.policy-${path.basename(info.root)}`);
}

export default function (pi: ExtensionAPI) {
	// Branch names cached for /wt-switch completions; getArgumentCompletions is
	// synchronous, so refresh on session_start and after each switch.
	let branchCache: string[] = [];

	const execInCwd = (cwd: string, args: string[]) => pi.exec("git", args, { cwd });

	async function refreshBranches(cwd: string): Promise<void> {
		try {
			const res = await execInCwd(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
			if (res.code === 0) branchCache = res.stdout.split("\n").filter(Boolean);
		} catch {
			// completion cache is best-effort
		}
	}

	async function repo(ctx: ExtensionCommandContext): Promise<RepoInfo | null> {
		const info = await gitInfo((cmd, args) => pi.exec(cmd, args, { cwd: ctx.cwd }));
		if (!info) ctx.ui.notify("Not inside a git repository.", "error");
		return info;
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshBranches(ctx.cwd);
	});

	pi.registerCommand("wt-name", {
		description: "Rename the checked-out branch (also renames its agent-bus note)",
		getArgumentCompletions: prefix => (prefix.length === 0 ? null : []),
		handler: async (args, ctx) => {
			const info = await repo(ctx);
			if (!info) return;

			let name = args.trim();
			if (!name) {
				name = (await ctx.ui.input("Rename branch to", info.branch || "agent/my-feature"))?.trim() ?? "";
			}
			if (!name) return;
			if (!isValidBranchName(name)) {
				ctx.ui.notify(`Invalid branch name: ${name}`, "error");
				return;
			}
			if (name === info.branch) return;

			const res = await execInCwd(ctx.cwd, ["branch", "-m", name]);
			if (res.code !== 0) {
				ctx.ui.notify(`git branch -m failed: ${res.stderr.trim()}`, "error");
				return;
			}

			if (info.branch) {
				const busDir = path.join(info.commonDir, "agent-bus");
				const oldNote = path.join(busDir, `${info.branch.replaceAll("/", "_")}.md`);
				const newNote = path.join(busDir, `${name.replaceAll("/", "_")}.md`);
				try {
					fs.renameSync(oldNote, newNote);
				} catch {
					// no bus note to rename
				}
			}
			branchCache = branchCache.map(b => (b === info.branch ? name : b));
			ctx.ui.notify(`Branch renamed: ${info.branch || "(detached)"} → ${name}`, "info");
		},
	});

	pi.registerCommand("wt-switch", {
		description: "Check out another branch inside this worktree (-c <name> to create)",
		getArgumentCompletions: prefix => {
			const lower = prefix.trim().toLowerCase();
			const matches = branchCache.filter(b => b.toLowerCase().startsWith(lower));
			return matches.length > 0 ? matches.map(b => ({ value: b, label: b })) : null;
		},
		handler: async (args, ctx) => {
			const info = await repo(ctx);
			if (!info) return;

			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /wt-switch <branch>  |  /wt-switch -c <new-branch>", "warning");
				return;
			}

			const create = trimmed.startsWith("-c ");
			const target = create ? trimmed.slice(3).trim() : trimmed;
			if (!isValidBranchName(target)) {
				ctx.ui.notify(`Invalid branch name: ${target}`, "error");
				return;
			}

			if (!create && !branchCache.includes(target)) {
				const choice = await ctx.ui.select(
					`Branch '${target}' does not exist locally. Create it?`,
					["Create and switch", "Cancel"],
				);
				if (choice !== "Create and switch") return;
			}

			const switchArgs = create || !branchCache.includes(target) ? ["switch", "-c", target] : ["switch", target];
			const res = await execInCwd(ctx.cwd, switchArgs);
			if (res.code !== 0) {
				ctx.ui.notify(`git switch failed: ${res.stderr.trim() || res.stdout.trim()}`, "error");
				return;
			}

			await refreshBranches(ctx.cwd);
			ctx.ui.notify(
				`Checked out '${target}' in ${info.root}${info.linked ? "" : " (primary checkout)"}`,
				"info",
			);
		},
	});

	const setPolicy = (policy: "keep" | "drop") => async (_args: string, ctx: ExtensionCommandContext) => {
		const info = await repo(ctx);
		if (!info) return;
		if (!info.linked) {
			ctx.ui.notify("Not inside a linked worktree; nothing will consume this policy.", "warning");
			return;
		}
		try {
			fs.mkdirSync(path.join(info.commonDir, "agent-bus"), { recursive: true });
			fs.writeFileSync(policyPath(info), policy);
			ctx.ui.notify(
				policy === "keep"
					? "Worktree will be kept on session exit."
					: "Worktree and branch will be discarded on session exit.",
				"info",
			);
		} catch (error) {
			ctx.ui.notify(`Could not write policy marker: ${error}`, "error");
		}
	};

	pi.registerCommand("wt-pull", {
		description:
			"Move uncommitted work (modified + untracked files) from another worktree into this one. Usage: /wt-pull [--copy] [branch|path] — default source is the primary checkout; default action moves (leaves source clean), --copy keeps it",
		getArgumentCompletions: prefix => {
			const lower = prefix.trim().toLowerCase();
			const matches = branchCache.filter(b => b.toLowerCase().startsWith(lower));
			return matches.length > 0 ? matches.map(b => ({ value: b, label: b })) : null;
		},
		handler: async (args, ctx) => {
			const info = await repo(ctx);
			if (!info) return;

			const tokens = args.trim().split(/\s+/).filter(Boolean);
			// Move is the default: source ends clean, which unblocks wt merge.
			const move = !tokens.includes("--copy") && !tokens.includes("-c");
			const srcArg = tokens.filter(t => !t.startsWith("-"))[0];

			// Resolve source worktree: default = primary checkout (first entry).
			const listRes = await execInCwd(ctx.cwd, ["worktree", "list", "--porcelain"]);
			if (listRes.code !== 0) {
				ctx.ui.notify(`git worktree list failed: ${listRes.stderr.trim()}`, "error");
				return;
			}
			const entries: { path: string; branch: string }[] = [];
			let current: { path: string; branch: string } = { path: "", branch: "" };
			for (const line of listRes.stdout.split("\n")) {
				if (line.startsWith("worktree ")) {
					if (current.path) entries.push(current);
					current = { path: line.slice(9).trim(), branch: "" };
				} else if (line.startsWith("branch ")) {
					current.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
				}
			}
			if (current.path) entries.push(current);
			if (entries.length === 0) {
				ctx.ui.notify("Could not enumerate worktrees.", "error");
				return;
			}

			let srcRoot: string;
			if (!srcArg) {
				srcRoot = entries[0].path;
			} else if (fs.existsSync(srcArg)) {
				const resolved = await execInCwd(srcArg, ["rev-parse", "--show-toplevel"]);
				srcRoot = resolved.stdout.trim();
			} else {
				const match = entries.find(e => e.branch === srcArg);
				srcRoot = match?.path ?? "";
			}
			if (!srcRoot) {
				ctx.ui.notify(`Cannot resolve source worktree for '${srcArg}'.`, "error");
				return;
			}
			if (srcRoot === info.root) {
				ctx.ui.notify("Source and target are the same worktree.", "warning");
				return;
			}

			// Anything to pull? (tracked diff or untracked non-ignored files)
			const diffRes = await execInCwd(srcRoot, ["diff", "--quiet", "HEAD", "--"]);
			const untrackedRes = await execInCwd(srcRoot, ["ls-files", "-o", "--exclude-standard"]);
			const hasChanges = diffRes.code !== 0 || untrackedRes.stdout.trim().length > 0;
			if (!hasChanges) {
				ctx.ui.notify(`Nothing to pull; ${srcRoot} is clean.`, "info");
				return;
			}

			// Stash in source (refs/stash is shared across linked worktrees),
			// then `stash apply` in the target performs a real merge — diverged
			// bases get proper conflict markers instead of patch rejects.
			const push = await execInCwd(srcRoot, ["stash", "push", "-u", "-m", "wt-pull", "--quiet"]);
			if (push.code !== 0) {
				ctx.ui.notify(`Could not stash source changes: ${push.stderr.trim()}`, "error");
				return;
			}
			const ourStash = (
				await execInCwd(srcRoot, ["rev-parse", "-q", "--verify", "refs/stash"])
			).stdout.trim();

			const apply = await execInCwd(ctx.cwd, ["stash", "apply", "--quiet", "stash@{0}"]);
			const applied = apply.code === 0;
			if (!applied) {
				ctx.ui.notify("Applied with conflicts — resolve them in this worktree.", "warning");
			}

			// Restore or retire the entry; only touch stash@{0} if still ours.
			const tipNow = (
				await execInCwd(srcRoot, ["rev-parse", "-q", "--verify", "refs/stash"])
			).stdout.trim();
			if (tipNow !== ourStash) {
				ctx.ui.notify(
					"Stash stack changed underneath; leaving stash entries alone.",
					"warning",
				);
				return;
			}
			if (move) {
				if (applied) {
					await execInCwd(srcRoot, ["stash", "drop", "-q", "stash@{0}"]);
					ctx.ui.notify(`Moved changes from ${srcRoot}; source is clean.`, "info");
				} else {
					ctx.ui.notify(
						`Kept stash@{0} as backup — drop it after resolving.`,
						"warning",
					);
				}
			} else {
				await execInCwd(srcRoot, ["stash", "pop", "-q", "stash@{0}"]);
				ctx.ui.notify(
					applied
						? `Copied changes from ${srcRoot}; source restored (default moves).`
						: `Copied changes from ${srcRoot} with conflicts; source restored.`,
					"info",
				);
			}
		},
	});

	pi.registerCommand("wt-merge", {
		description:
			"Commit and merge this branch into the default branch (wt merge --no-remove: stages pending changes, squashes, rebases, runs pre-merge verify hooks, fast-forwards). Worktree is kept for the session; drop it on exit. Usage: /wt-merge [target-branch]",
		getArgumentCompletions: prefix => {
			const lower = prefix.trim().toLowerCase();
			const matches = branchCache.filter(b => b.toLowerCase().startsWith(lower));
			return matches.length > 0 ? matches.map(b => ({ value: b, label: b })) : null;
		},
		handler: async (args, ctx) => {
			const info = await repo(ctx);
			if (!info) return;
			if (!info.branch) {
				ctx.ui.notify("Detached HEAD — wt merge needs a branch.", "error");
				return;
			}
			const target = args.trim() || info.baseBranch;
			if (info.branch === target) {
				ctx.ui.notify(`Already on '${target}' — nothing to merge.`, "warning");
				return;
			}

			// Resolve wt through PATH but reject Windows mounts — under WSL,
			// /mnt/c/.../wt.exe is Windows Terminal, not Worktrunk.
			const which = await pi.exec("sh", ["-c", "command -v wt"], { cwd: ctx.cwd });
			const wtBin = which.stdout.trim().split("\n")[0] ?? "";
			if (!wtBin || wtBin.startsWith("/mnt/") || wtBin.endsWith(".exe")) {
				ctx.ui.notify(
					`Cannot find a usable 'wt' binary (got '${wtBin || "nothing"}'). Check PATH / mise shims.`,
					"error",
				);
				return;
			}

			const confirmed = await ctx.ui.confirm(
				`Merge '${info.branch}' into '${target}'?`,
				"Pending changes are committed (squashed), the branch is rebased, pre-merge verify hooks run, and the target fast-forwards. The worktree is kept so this session is not orphaned.",
			);
			if (!confirmed) return;

			const res = await pi.exec(wtBin, ["merge", "--no-remove", "-y", target], { cwd: ctx.cwd });
			if (res.code !== 0) {
				ctx.ui.notify(
					`wt merge failed (exit ${res.code}):\n${(res.stderr || res.stdout).trim()}\nA rebase conflict is left open in this worktree — resolve or \`git rebase --abort\`.`,
					"error",
				);
				return;
			}
			ctx.ui.notify(
				`Merged ${info.branch} → ${target}. Worktree kept for this session — drop it on exit.`,
				"info",
			);
		},
	});

	pi.registerCommand("wt-keep", {
		description: "Keep this worktree on session exit without prompting",
		handler: setPolicy("keep"),
	});

	pi.registerCommand("wt-drop", {
		description: "Discard this worktree and its branch on session exit",
		handler: setPolicy("drop"),
	});

	pi.registerCommand("wt-status", {
		description: "Show current branch, worktree root, commits ahead, and dirty count",
		handler: async (_args, ctx) => {
			const info = await repo(ctx);
			if (!info) return;
			const ahead = await execInCwd(ctx.cwd, ["rev-list", "--count", "HEAD", `^${info.baseBranch}`]);
			const dirty = await execInCwd(ctx.cwd, ["status", "--porcelain", "--untracked-files=no"]);
			const dirtyCount = dirty.stdout.split("\n").filter(Boolean).length;
			const policy = fs.existsSync(policyPath(info)) ? fs.readFileSync(policyPath(info), "utf8").trim() : "none";
			ctx.ui.notify(
				[
					`branch:  ${info.branch || "(detached)"}`,
					`root:    ${info.root}${info.linked ? " (linked worktree)" : " (primary checkout)"}`,
					`ahead:   ${ahead.stdout.trim() || "0"} commit(s) vs ${info.baseBranch}`,
					`dirty:   ${dirtyCount} tracked file(s)`,
					`policy:  ${policy}`,
				].join("\n"),
				"info",
			);
		},
	});
}
