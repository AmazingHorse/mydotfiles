export type PermissionRules = {
	allow: string[];
	ask: string[];
	deny: string[];
	allowOutside?: string[];
	allowedPaths?: string[];
};

export type PermissionLevel = {
	name: "session" | "projectLocal" | "project" | "user" | "defaults";
	rules: PermissionRules;
};

export type SegmentDecision =
	| { kind: "allow" }
	| { kind: "deny"; rule: string }
	| { kind: "ask"; rule: string; persistable: boolean }
	| { kind: "unmatched"; persistable: boolean };

export type ParsedWord = {
	text: string;
	quote?: "'" | '"' | "mixed";
	isRedirectTarget?: boolean;
	hasTemplate?: boolean;
};

export type ParsedSegment = {
	words: ParsedWord[];
};

export type ShellParseResult = {
	segments: string[][];
	parsedSegments: ParsedSegment[];
	complex: boolean;
};
