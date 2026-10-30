import type { ParsedWord } from "./types.ts";

export const SUBCOMMAND_TOOLS: Record<string, true> = {
	git: true,
	npm: true,
	pnpm: true,
	yarn: true,
	bun: true,
	cargo: true,
	go: true,
	docker: true,
	kubectl: true,
	gh: true,
	chezmoi: true,
	mise: true,
	uv: true,
	just: true,
	pip: true,
	python: true,
	python3: true,
	npx: true,
};

export const THREE_WORD_PREFIXES: Record<string, true> = {
	"npm run": true,
	"pnpm run": true,
	"yarn run": true,
	"bun run": true,
	"uv run": true,
	"python -m": true,
	"python3 -m": true,
};

// Known global flags that take a separate argument
const VALUE_FLAGS_BY_TOOL: Record<string, Record<string, true>> = {
	chezmoi: {
		"--source": true,
		"-S": true,
		"--config": true,
		"-c": true,
		"--destination": true,
		"-D": true,
		"--working-tree": true,
		"-W": true,
		"--override-data": true,
		"--cache": true,
	},
	git: {
		"-C": true,
		"--git-dir": true,
		"--work-tree": true,
		"--namespace": true,
	},
	just: {
		"-f": true,
		"--justfile": true,
		"-d": true,
		"--working-directory": true,
	},
	docker: {
		"--context": true,
		"-c": true,
		"-H": true,
		"--host": true,
		"--config": true,
	},
	kubectl: {
		"--context": true,
		"-n": true,
		"--namespace": true,
		"--kubeconfig": true,
		"--cluster": true,
		"--user": true,
	},
};

// Known global boolean/standalone flags
const BOOL_FLAGS_BY_TOOL: Record<string, Record<string, true>> = {
	chezmoi: {
		"--no-tty": true,
		"--no-pager": true,
		"-v": true,
		"--verbose": true,
		"-q": true,
		"--quiet": true,
		"-k": true,
		"--keep-going": true,
		"-n": true,
		"--dry-run": true,
		"--refresh-externals": true,
	},
	git: {
		"--no-pager": true,
		"--bare": true,
		"--no-replace-objects": true,
		"-v": true,
		"--version": true,
	},
	just: {
		"-q": true,
		"--quiet": true,
		"-v": true,
		"--verbose": true,
		"-g": true,
		"--global-justfile": true,
		"--no-dotenv": true,
		"--unsorted": true,
		"--unstable": true,
	},
};

/**
 * Extracts the canonical tokens for a command by skipping benign global options
 * that precede the subcommand (e.g. `chezmoi --source . data` -> `["chezmoi", "data"]`).
 */
export function canonicalCommandTokens(words: string[] | ParsedWord[]): string[] {
	const rawWords = words.map(w => (typeof w === "string" ? w : w.text));
	if (rawWords.length === 0) return [];

	const binary = rawWords[0];
	if (!SUBCOMMAND_TOOLS[binary]) {
		return rawWords;
	}

	const valueFlags = VALUE_FLAGS_BY_TOOL[binary] || {};
	const boolFlags = BOOL_FLAGS_BY_TOOL[binary] || {};

	const filteredTokens: string[] = [binary];
	let index = 1;

	while (index < rawWords.length) {
		const token = rawWords[index];

		// If we encounter a double-dash stopper, stop skipping flags
		if (token === "--") {
			index++;
			break;
		}

		// Check if it's a value-taking flag with inline '=' e.g. --source=/foo
		const eqIndex = token.indexOf("=");
		if (eqIndex > 0) {
			const flagName = token.slice(0, eqIndex);
			if (valueFlags[flagName]) {
				index++;
				continue;
			}
		}

		// Check if it's a value-taking flag with separate value
		if (valueFlags[token]) {
			index += 2;
			continue;
		}

		// Check if it's a boolean flag
		if (boolFlags[token]) {
			index++;
			continue;
		}

		// Check generic boolean flag patterns: -v, -q, --quiet, --color=*
		if (token.startsWith("--color=") || token === "--no-color") {
			index++;
			continue;
		}

		// First non-flag argument encountered is the subcommand
		break;
	}

	// Append the rest of the arguments starting from the subcommand
	while (index < rawWords.length) {
		filteredTokens.push(rawWords[index]);
		index++;
	}

	return filteredTokens;
}

export function matchesPrefix(words: string[] | ParsedWord[], prefix: string): boolean {
	const ruleWords = prefix.split(/\s+/).filter(word => word.length > 0);
	if (ruleWords.length === 0) return false;

	const canonical = canonicalCommandTokens(words);
	if (canonical.length < ruleWords.length) return false;

	return ruleWords.every((ruleWord, index) => canonical[index] === ruleWord);
}

export function commandPrefix(words: string[] | ParsedWord[]): string {
	const canonical = canonicalCommandTokens(words);
	if (canonical.length === 0) return "";

	const twoWords = canonical.slice(0, 2).join(" ");
	if (canonical.length >= 3 && THREE_WORD_PREFIXES[twoWords]) {
		return canonical.slice(0, 3).join(" ");
	}
	if (canonical.length >= 2 && SUBCOMMAND_TOOLS[canonical[0]]) {
		return twoWords;
	}
	return canonical[0];
}
