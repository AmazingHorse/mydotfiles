import type { ParsedSegment, ParsedWord, ShellParseResult } from "./types.ts";

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_FLOW_KEYWORDS: Record<string, true> = {
	if: true,
	then: true,
	elif: true,
	else: true,
	fi: true,
	while: true,
	until: true,
	do: true,
	done: true,
	"!": true,
	"{": true,
	"}": true,
};

type PendingHeredoc = {
	delimiter: string;
	quoted: boolean;
	stripTabs: boolean;
};

type ContextState = "root" | "dquote" | "subst";

function hasTemplateSyntax(text: string): boolean {
	return (
		(text.includes("{{") && text.includes("}}")) ||
		text.startsWith("{{-") ||
		text.endsWith("-}}")
	);
}

function isEscapedByIndex(str: string, idx: number): boolean {
	let backslashes = 0;
	let i = idx - 1;
	while (i >= 0 && str[i] === "\\") {
		backslashes++;
		i--;
	}
	return backslashes % 2 === 1;
}

function containsUnescapedExpansions(line: string): boolean {
	for (let i = 0; i < line.length; i++) {
		if (isEscapedByIndex(line, i)) continue;
		if (line[i] === "`") return true;
		if (line[i] === "$" && i + 1 < line.length) {
			const next = line[i + 1];
			if (next === "(" || next === "{") return true;
		}
	}
	return false;
}

function parseHeredocDelimiter(
	command: string,
	startIndex: number,
): { delimiter: string; quoted: boolean; endIndex: number } {
	let index = startIndex;
	while (index < command.length && (command[index] === " " || command[index] === "\t")) {
		index++;
	}

	let delimiter = "";
	let quoted = false;

	while (index < command.length && !/[\s;|&<>\n]/.test(command[index])) {
		const char = command[index];
		if (char === "\\") {
			quoted = true;
			index++;
			if (index < command.length) {
				delimiter += command[index];
				index++;
			}
		} else if (char === "'" || char === '"') {
			quoted = true;
			const quoteChar = char;
			index++;
			while (index < command.length && command[index] !== quoteChar) {
				if (quoteChar === '"' && command[index] === "\\" && index + 1 < command.length) {
					index++;
					delimiter += command[index];
				} else {
					delimiter += command[index];
				}
				index++;
			}
			if (index < command.length && command[index] === quoteChar) {
				index++;
			}
		} else {
			delimiter += char;
			index++;
		}
	}

	return { delimiter, quoted, endIndex: index };
}

export function parseShellCommand(command: string): ShellParseResult {
	const parsedSegments: ParsedSegment[] = [];
	let currentWords: ParsedWord[] = [];
	let currentText = "";
	let currentQuotes: Array<"'" | '"'> = [];
	let isNextWordRedirectTarget = false;
	let complex = false;
	let pendingHeredocs: PendingHeredoc[] = [];

	const flushWord = () => {
		if (currentText.length > 0) {
			let quoteType: "'" | '"' | "mixed" | undefined;
			if (currentQuotes.length === 1) {
				quoteType = currentQuotes[0];
			} else if (currentQuotes.length > 1) {
				quoteType = "mixed";
			}
			currentWords.push({
				text: currentText,
				quote: quoteType,
				isRedirectTarget: isNextWordRedirectTarget,
				hasTemplate: hasTemplateSyntax(currentText),
			});
			currentText = "";
			currentQuotes = [];
			isNextWordRedirectTarget = false;
		}
	};

	const flushSegment = () => {
		flushWord();
		while (currentWords.length > 0 && ENV_ASSIGNMENT.test(currentWords[0].text)) {
			currentWords.shift();
		}
		while (
			currentWords.length > 0 &&
			currentWords[0].quote === undefined &&
			SHELL_FLOW_KEYWORDS[currentWords[0].text]
		) {
			currentWords.shift();
		}
		// Handle for loop headers: for var in a b c; -> strip 'for var in'
		if (
			currentWords.length >= 3 &&
			currentWords[0].quote === undefined &&
			currentWords[0].text === "for" &&
			currentWords[2].quote === undefined &&
			currentWords[2].text === "in"
		) {
			currentWords.splice(0, 3);
		}

		if (currentWords.length > 0) {
			parsedSegments.push({ words: currentWords });
		}
		currentWords = [];
	};

	let index = 0;

	const consumePendingHeredocs = () => {
		for (const heredoc of pendingHeredocs) {
			let line = "";
			let matched = false;
			while (index < command.length) {
				const c = command[index];
				if (c === "\n") {
					let compareLine = line.endsWith("\r") ? line.slice(0, -1) : line;
					if (heredoc.stripTabs) {
						compareLine = compareLine.replace(/^\t+/, "");
					}
					if (compareLine === heredoc.delimiter) {
						index++; // consume \n
						matched = true;
						line = "";
						break;
					}
					if (!heredoc.quoted && containsUnescapedExpansions(line)) {
						complex = true;
					}
					line = "";
					index++;
				} else {
					line += c;
					index++;
				}
			}
			if (!matched && line.length > 0) {
				let compareLine = line.endsWith("\r") ? line.slice(0, -1) : line;
				if (heredoc.stripTabs) {
					compareLine = compareLine.replace(/^\t+/, "");
				}
				if (compareLine === heredoc.delimiter) {
					matched = true;
					line = "";
				} else if (!heredoc.quoted && containsUnescapedExpansions(line)) {
					complex = true;
				}
			}
			if (!matched && !heredoc.quoted) {
				complex = true;
			}
		}
		pendingHeredocs = [];
	};
	const stack: ContextState[] = ["root"];

	while (index < command.length) {
		const char = command[index];
		const ctx = stack[stack.length - 1];

		if (ctx === "dquote") {
			if (char === '"') {
				stack.pop();
				index++;
				continue;
			}
			if (char === "\\" && index + 1 < command.length) {
				currentText += command[index + 1];
				index += 2;
				continue;
			}
			if (char === "`") {
				complex = true;
			}
			if (char === "$" && command[index + 1] === "(") {
				complex = true;
				currentText += "$(";
				stack.push("subst");
				index += 2;
				continue;
			}
			currentText += char;
			index++;
			continue;
		}

		if (ctx === "subst") {
			if (char === "\\") {
				if (index + 1 < command.length && command[index + 1] === "\n") {
					index += 2;
					continue;
				}
				if (index + 1 < command.length) {
					currentText += command[index] + command[index + 1];
					index += 2;
				} else {
					currentText += char;
					index++;
				}
				continue;
			}
			if (char === "'") {
				currentText += "'";
				index++;
				while (index < command.length && command[index] !== "'") {
					currentText += command[index];
					index++;
				}
				if (index < command.length && command[index] === "'") {
					currentText += "'";
					index++;
				}
				continue;
			}
			if (char === '"') {
				currentText += '"';
				stack.push("dquote");
				index++;
				continue;
			}
			if (char === "$" && command[index + 1] === "(") {
				complex = true;
				currentText += "$(";
				stack.push("subst");
				index += 2;
				continue;
			}
			if (char === ")") {
				stack.pop();
				currentText += ")";
				index++;
				continue;
			}
			if (char === "<" && command[index + 1] === "<" && command[index + 2] !== "<") {
				index += 2;
				let stripTabs = false;
				if (command[index] === "-") {
					stripTabs = true;
					index++;
				}
				const parsed = parseHeredocDelimiter(command, index);
				index = parsed.endIndex;
				if (parsed.delimiter.length > 0) {
					pendingHeredocs.push({
						delimiter: parsed.delimiter,
						quoted: parsed.quoted,
						stripTabs,
					});
				}
				continue;
			}
			if (char === "\n") {
				if (pendingHeredocs.length > 0) {
					index++;
					consumePendingHeredocs();
				} else {
					currentText += char;
					index++;
				}
				continue;
			}
			currentText += char;
			index++;
			continue;
		}

		// ctx === "root"
		// Backslash escape outside quotes
		if (char === "\\") {
			if (index + 1 < command.length && command[index + 1] === "\n") {
				index += 2; // Line continuation
				continue;
			}
			if (index + 1 < command.length) {
				currentText += command[index + 1];
				index += 2;
			} else {
				index++;
			}
			continue;
		}

		// Comment start: '#' when starting a word
		if (char === "#" && currentText.length === 0) {
			while (index < command.length && command[index] !== "\n") {
				index++;
			}
			continue;
		}

		// Entering single quote
		if (char === "'") {
			currentQuotes.push("'");
			index++;
			while (index < command.length && command[index] !== "'") {
				currentText += command[index];
				index++;
			}
			if (index < command.length && command[index] === "'") {
				index++;
			}
			continue;
		}

		// Entering double quote
		if (char === '"') {
			currentQuotes.push('"');
			stack.push("dquote");
			index++;
			continue;
		}

		// Command substitution $(...)
		if (char === "$" && command[index + 1] === "(") {
			complex = true;
			currentText += "$(";
			stack.push("subst");
			index += 2;
			continue;
		}

		// Backtick substitution `...`
		if (char === "`") {
			complex = true;
			currentText += char;
			index++;
			while (index < command.length && command[index] !== "`") {
				currentText += command[index];
				index++;
			}
			if (index < command.length) {
				currentText += "`";
				index++;
			}
			continue;
		}

		// Process substitution <(...) or >(...)
		if ((char === ">" || char === "<") && command[index + 1] === "(") {
			complex = true;
			currentText += `${char}(`;
			stack.push("subst");
			index += 2;
			continue;
		}

		// Heredoc operator: << or <<- (with FD prefix handling)
		if (char === "<" && command[index + 1] === "<" && command[index + 2] !== "<") {
			if (/^\d+$/.test(currentText) && currentQuotes.length === 0) {
				currentText = "";
			} else {
				flushWord();
			}
			index += 2;
			let stripTabs = false;
			if (command[index] === "-") {
				stripTabs = true;
				index++;
			}
			const parsed = parseHeredocDelimiter(command, index);
			index = parsed.endIndex;
			if (parsed.delimiter.length > 0) {
				pendingHeredocs.push({
					delimiter: parsed.delimiter,
					quoted: parsed.quoted,
					stripTabs,
				});
			}
			continue;
		}

		// Here-string: <<<
		if (char === "<" && command[index + 1] === "<" && command[index + 2] === "<") {
			flushWord();
			index += 3;
			continue;
		}

		// Normal Redirections: >, >>, >|, <, <>
		if (char === ">" || char === "<") {
			if (/^\d+$/.test(currentText) && currentQuotes.length === 0) {
				currentText = "";
			} else {
				flushWord();
			}
			index++;
			while (index < command.length && (command[index] === ">" || command[index] === "<")) {
				index++;
			}
			if (command[index] === "|") index++;
			if (command[index] === "&") {
				index++;
				while (index < command.length && /[0-9-]/.test(command[index])) index++;
			} else {
				isNextWordRedirectTarget = true;
			}
			continue;
		}

		// Redirection: &> or &>>
		if (char === "&" && command[index + 1] === ">") {
			if (/^\d+$/.test(currentText) && currentQuotes.length === 0) {
				currentText = "";
			} else {
				flushWord();
			}
			index += 2;
			if (command[index] === ">") index++;
			isNextWordRedirectTarget = true;
			continue;
		}

		// Logical AND (&&) or background (&)
		if (char === "&") {
			flushSegment();
			index++;
			if (command[index] === "&") index++;
			continue;
		}

		// Pipe (|) or Logical OR (||)
		if (char === "|") {
			flushSegment();
			index++;
			if (command[index] === "|" || command[index] === "&") index++;
			continue;
		}

		// Command separator: ; or \n
		if (char === ";" || char === "\n") {
			flushSegment();
			index++;
			if (char === "\n" && pendingHeredocs.length > 0) {
				consumePendingHeredocs();
			}
			continue;
		}

		// Whitespace
		if (/\s/.test(char)) {
			flushWord();
			index++;
			continue;
		}

		currentText += char;
		index++;
	}

	flushSegment();

	if (pendingHeredocs.length > 0) {
		consumePendingHeredocs();
	}

	const legacySegments = parsedSegments.map(seg => seg.words.map(w => w.text));
	return {
		segments: legacySegments,
		parsedSegments,
		complex,
	};
}

export function splitShellSegments(command: string): { segments: string[][]; complex: boolean } {
	const result = parseShellCommand(command);
	return {
		segments: result.segments,
		complex: result.complex,
	};
}
