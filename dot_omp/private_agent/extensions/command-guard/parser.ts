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

function hasTemplateSyntax(text: string): boolean {
	return (
		(text.includes("{{") && text.includes("}}")) ||
		text.startsWith("{{-") ||
		text.endsWith("-}}")
	);
}

export function parseShellCommand(command: string): ShellParseResult {
	const parsedSegments: ParsedSegment[] = [];
	let currentWords: ParsedWord[] = [];
	let currentText = "";
	let currentQuotes: Array<"'" | '"'> = [];
	let isNextWordRedirectTarget = false;
	let complex = false;
	let quote: "'" | '"' | undefined;
	let substitutionDepth = 0;
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
	while (index < command.length) {
		const char = command[index];

		// Inside single quotes: literal until next single quote
		if (quote === "'") {
			if (char === "'") {
				quote = undefined;
			} else {
				currentText += char;
			}
			index++;
			continue;
		}

		// Inside double quotes
		if (quote === '"') {
			if (char === '"') {
				quote = undefined;
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
				substitutionDepth++;
				index += 2;
				continue;
			}
			currentText += char;
			index++;
			continue;
		}

		// Inside command substitution $(...)
		if (substitutionDepth > 0) {
			if (char === "(") {
				substitutionDepth++;
			} else if (char === ")") {
				substitutionDepth--;
			}
			currentText += char;
			index++;
			continue;
		}

		// Escape outside quotes
		if (char === "\\") {
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
			// Skip until end of line
			while (index < command.length && command[index] !== "\n") {
				index++;
			}
			continue;
		}

		// Entering single quote
		if (char === "'") {
			quote = "'";
			currentQuotes.push("'");
			index++;
			continue;
		}

		// Entering double quote
		if (char === '"') {
			quote = '"';
			currentQuotes.push('"');
			index++;
			continue;
		}

		// Command substitution $(...)
		if (char === "$" && command[index + 1] === "(") {
			complex = true;
			currentText += "$(";
			substitutionDepth++;
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
			substitutionDepth++;
			index += 2;
			continue;
		}

		// Heredoc operator: << or <<-
		if (char === "<" && command[index + 1] === "<" && command[index + 2] !== "<") {
			flushWord();
			index += 2;
			let stripTabs = false;
			if (command[index] === "-") {
				stripTabs = true;
				index++;
			}
			// Skip whitespace before delimiter
			while (index < command.length && (command[index] === " " || command[index] === "\t")) {
				index++;
			}
			let delimiter = "";
			let heredocQuoted = false;
			while (index < command.length && !/[\s;|&<>\n]/.test(command[index])) {
				const delimChar = command[index];
				if (delimChar === "'" || delimChar === '"' || delimChar === "\\") {
					heredocQuoted = true;
					if (delimChar === "\\" && index + 1 < command.length) {
						index++;
						delimiter += command[index];
					} else if (delimChar === "'" || delimChar === '"') {
						const delimQuote = delimChar;
						index++;
						while (index < command.length && command[index] !== delimQuote) {
							delimiter += command[index];
							index++;
						}
					}
				} else {
					delimiter += delimChar;
				}
				index++;
			}
			if (delimiter.length > 0) {
				pendingHeredocs.push({ delimiter, quoted: heredocQuoted, stripTabs });
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
			if (/^\d+$/.test(currentText)) {
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
				// File descriptor duplicate: 2>&1, <&-
				while (index < command.length && /[0-9-]/.test(command[index])) index++;
			} else {
				isNextWordRedirectTarget = true;
			}
			continue;
		}

		// Redirection: &> or &>>
		if (char === "&" && command[index + 1] === ">") {
			if (/^\d+$/.test(currentText)) {
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
			// If we just hit a newline and there are pending heredocs, consume their bodies now!
			if (char === "\n" && pendingHeredocs.length > 0) {
				for (const heredoc of pendingHeredocs) {
					let line = "";
					while (index < command.length) {
						if (command[index] === "\n") {
							let compareLine = line.endsWith("\r") ? line.slice(0, -1) : line;
							if (heredoc.stripTabs) {
								compareLine = compareLine.replace(/^\t+/, "");
							}
							if (compareLine === heredoc.delimiter) {
								index++; // consume \n
								line = "";
								break;
							}
							if (!heredoc.quoted) {
								if (line.includes("$(") || line.includes("`")) {
									complex = true;
								}
							}
							line = "";
						} else {
							line += command[index];
						}
						index++;
					}
					// Check last line if stream ended without trailing newline
					if (line.length > 0) {
						let compareLine = line.endsWith("\r") ? line.slice(0, -1) : line;
						if (heredoc.stripTabs) {
							compareLine = compareLine.replace(/^\t+/, "");
						}
						if (compareLine !== heredoc.delimiter && !heredoc.quoted) {
							if (line.includes("$(") || line.includes("`")) {
								complex = true;
							}
						}
					}
				}
				pendingHeredocs = [];
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

	// Process any heredoc remaining at the end of input
	if (pendingHeredocs.length > 0) {
		for (const heredoc of pendingHeredocs) {
			if (!heredoc.quoted) {
				complex = true;
			}
		}
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
