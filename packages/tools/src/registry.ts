import type { z } from "zod";
import type { AnyAurumTool, AurumTool } from "./types";
import { zodToJsonSchema } from "./zod-json";

/**
 * Central tool registry. Tools register once; the AI never gets
 * unrestricted system access — only registered tools.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyAurumTool>();

  register<TSchema extends z.ZodTypeAny>(tool: AurumTool<TSchema>): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool as unknown as AnyAurumTool);
  }

  get(id: string): AnyAurumTool | undefined {
    return this.tools.get(id);
  }

  list(): AnyAurumTool[] {
    return [...this.tools.values()];
  }

  listEnabled(): AnyAurumTool[] {
    return this.list().filter(
      (t) => t.enabled !== false && t.permission !== "RESTRICTED",
    );
  }

  /** Gemini functionDeclarations */
  toGeminiFunctionDeclarations(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return this.listEnabled().map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters:
        tool.parametersJsonSchema ??
        (zodToJsonSchema(tool.inputSchema) as Record<string, unknown>),
    }));
  }

  /** @deprecated Prefer toGeminiFunctionDeclarations */
  toOpenAITools(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }> {
    return this.toGeminiFunctionDeclarations().map((d) => ({
      type: "function" as const,
      function: {
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      },
    }));
  }
}
