declare module "@oh-my-pi/pi-coding-agent" {
	export interface ExtensionUIContext {
		notify(message: string): void;
		select(prompt: string, options: string[]): Promise<string>;
	}

	export interface ExtensionContext {
		cwd: string;
		hasUI: boolean;
		ui: ExtensionUIContext;
	}

	export interface ToolCallEvent {
		toolName: string;
		input: Record<string, unknown>;
	}

	export interface ToolCallEventResult {
		block?: boolean;
		reason?: string;
	}

	export interface ContextEvent {
		messages: unknown[];
	}

	export interface ContextEventResult {
		messages: unknown[];
	}

	export interface ZodTypeSchema<T = unknown> {
		describe(description: string): ZodTypeSchema<T>;
	}

	export interface ExtensionZod {
		object<TShape extends Record<string, ZodTypeSchema<unknown>>>(
			shape: TShape,
		): ZodTypeSchema<{ [K in keyof TShape]: TShape[K] extends ZodTypeSchema<infer TVal> ? TVal : unknown }>;
		string(): ZodTypeSchema<string>;
	}

	export interface ToolDefinition<TSchema extends ZodTypeSchema<unknown> = ZodTypeSchema<unknown>, TDetails = unknown> {
		name: string;
		label: string;
		description: string;
		parameters: TSchema;
		execute: (
			toolCallId: string,
			params: TSchema extends ZodTypeSchema<infer TParams> ? TParams : unknown,
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: ExtensionContext,
		) => Promise<{ content: Array<{ type: string; text: string }>; details?: TDetails }>;
	}

	export interface ExtensionAPI {
		on(event: "session_start", handler: (event: unknown, ctx: ExtensionContext) => void): void;
		on(
			event: "tool_call",
			handler: (
				event: ToolCallEvent,
				ctx: ExtensionContext,
			) => Promise<ToolCallEventResult | void> | ToolCallEventResult | void,
		): void;
		on(event: "context", handler: (event: ContextEvent, ctx: ExtensionContext) => ContextEventResult | void): void;
		on(event: string, handler: (...args: unknown[]) => unknown): void;
		zod: ExtensionZod;
		registerTool<TParams = unknown, TDetails = unknown>(definition: ToolDefinition<TParams, TDetails>): void;
		exec(
			command: string,
			args: string[],
			options?: { signal?: AbortSignal; timeout?: number },
		): Promise<{ code: number; stdout: string; stderr: string; killed?: boolean }>;
	}
}
