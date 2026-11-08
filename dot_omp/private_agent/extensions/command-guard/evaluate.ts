import { parseShellCommand } from "./parser.ts";
import { decideSegment } from "./rules.ts";
import type { ParsedWord, PermissionLevel, SegmentDecision } from "./types.ts";

export type CommandVerdict = {
	verdict: "allow" | "ask" | "deny" | "unmatched";
	reasons: string[];
	persistable: boolean;
	decisions: Array<{ words: ParsedWord[]; decision: SegmentDecision }>;
	complex: boolean;
};

export function decisionReason(decision: SegmentDecision): string {
	if (decision.kind === "ask") return decision.persistable ? `ask rule: ${decision.rule}` : decision.rule;
	if (decision.kind === "unmatched") return "unmatched";
	if (decision.kind === "deny") return `deny rule: ${decision.rule}`;
	return "allowed";
}

export function evaluateCommand(
	command: string,
	cwd: string,
	home: string,
	levels: PermissionLevel[],
): CommandVerdict {
	const { parsedSegments, complex } = parseShellCommand(command);
	const decisions = parsedSegments.map(seg => ({
		words: seg.words,
		decision: decideSegment(seg.words, levels, cwd, home),
	}));

	const denied = decisions.find(d => d.decision.kind === "deny");
	if (denied) {
		return {
			verdict: "deny",
			reasons: [decisionReason(denied.decision)],
			persistable: false,
			decisions,
			complex,
		};
	}

	const pendingDecisions: SegmentDecision[] = [];
	if (complex) {
		pendingDecisions.push({
			kind: "ask",
			rule: "complex shell syntax (command substitution, redirections, or multiline flow)",
			persistable: false,
		});
	}

	for (const entry of decisions) {
		if (entry.decision.kind === "ask" || entry.decision.kind === "unmatched") {
			pendingDecisions.push(entry.decision);
		}
	}

	const askDecisions = pendingDecisions.filter(d => d.kind === "ask");
	if (askDecisions.length > 0) {
		const hasProtected = askDecisions.some(d => d.rule.startsWith("protected agent config:"));
		const hasOutside = askDecisions.some(
			d => d.rule.startsWith("path outside workspace:") || Boolean(d.outsidePaths?.length),
		);
		const persistable =
			!complex &&
			!hasProtected &&
			!hasOutside &&
			pendingDecisions.every(
				d => (d.kind === "ask" || d.kind === "unmatched") && d.persistable,
			);

		return {
			verdict: "ask",
			reasons: pendingDecisions.map(d => decisionReason(d)),
			persistable,
			decisions,
			complex,
		};
	}

	const unmatched = decisions.find(d => d.decision.kind === "unmatched");
	if (unmatched) {
		return {
			verdict: "unmatched",
			reasons: ["unmatched"],
			persistable: true,
			decisions,
			complex,
		};
	}

	return {
		verdict: "allow",
		reasons: ["allowed"],
		persistable: false,
		decisions,
		complex,
	};
}
