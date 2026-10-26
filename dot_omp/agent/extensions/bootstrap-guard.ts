import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const KEEP_RECENT_MESSAGES = 6;
const TRUNCATE_THRESHOLD = 800;
const TRUNCATE_TO = 400;
const TRUNCATION_MARKER = "[bootstrap-guard: truncated ";

/**
 * Placeholder until fp CLI middleware can compact tool results through pi.exec("fp", [...]).
 */
function compactToolResult(message: unknown): unknown {
	if (typeof message !== "object" || message === null) return message;

	const record = message as Record<string, unknown>;
	if (record.role !== "toolResult") return message;

	if (typeof record.content === "string") {
		const text = record.content;
		if (text.length <= TRUNCATE_THRESHOLD || text.includes(TRUNCATION_MARKER)) return message;
		return {
			...record,
			content: `${text.slice(0, TRUNCATE_TO)}\n…${TRUNCATION_MARKER}${text.length - TRUNCATE_TO} chars]`,
		};
	}

	if (!Array.isArray(record.content)) return message;
	const textBlocks = record.content.filter(
		(block): block is { type: "text"; text: string } =>
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "text" &&
			"text" in block &&
			typeof block.text === "string",
	);
	const joinedText = textBlocks.map(block => block.text).join("\n");
	const textLength = textBlocks.reduce((length, block) => length + block.text.length, 0);
	if (textLength <= TRUNCATE_THRESHOLD || joinedText.includes(TRUNCATION_MARKER)) return message;

	const compactedContent: unknown[] = [];
	let insertedSummary = false;
	for (const block of record.content) {
		if (
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "text" &&
			"text" in block &&
			typeof block.text === "string"
		) {
			if (!insertedSummary) {
				compactedContent.push({
					...block,
					text: `${joinedText.slice(0, TRUNCATE_TO)}\n…${TRUNCATION_MARKER}${joinedText.length - TRUNCATE_TO} chars]`,
				});
				insertedSummary = true;
			}
		} else {
			compactedContent.push(block);
		}
	}

	return { ...record, content: compactedContent };
}

export default function (pi: ExtensionAPI) {
	pi.on("context", event => {
		const cutoff = Math.max(0, event.messages.length - KEEP_RECENT_MESSAGES);
		const messages = event.messages.map((message, index) =>
			index < cutoff ? (compactToolResult(message) as typeof message) : message,
		);
		return { messages };
	});

	const parameters = pi.zod.object({
		query: pi.zod.string().describe("The web research question to search for."),
	});
	pi.registerTool<typeof parameters>({
		name: "agy_web_search",
		label: "Antigravity web research",
		description: "Use Antigravity (prepaid Google credits) for web research.",
		parameters,
		async execute(_toolCallId, params, signal) {
			const result = await pi.exec("agy", ["--mode", "plan", "--print", params.query], {
				signal,
				timeout: 120_000,
			});
			if (result.code !== 0 || result.killed) {
				const stderr = result.stderr.slice(0, 400);
				throw new Error(
					`agy web research failed with code ${result.code}${result.killed ? " (killed)" : ""}: ${stderr}`,
				);
			}
			return {
				content: [{ type: "text", text: result.stdout }],
				details: { exitCode: result.code },
			};
		},
	});
}
