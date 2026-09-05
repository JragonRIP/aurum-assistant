import type { z } from "zod";

/**
 * Minimal Zod → JSON Schema mapper for Gemini function declarations.
 * Supports object/string/number/boolean/enum/optional/nullable/array.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as {
    typeName?: string;
    description?: string;
    innerType?: z.ZodTypeAny;
    schema?: z.ZodTypeAny;
    values?: string[];
    entries?: Record<string, z.ZodTypeAny>; // zod 4
    shape?: () => Record<string, z.ZodTypeAny>;
    type?: z.ZodTypeAny;
    valueType?: z.ZodTypeAny;
    options?: z.ZodTypeAny[];
  };

  const typeName = def.typeName ?? "";

  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    return convert(def.innerType!);
  }
  if (typeName === "ZodNullable") {
    const inner = convert(def.innerType!);
    return { ...inner, nullable: true };
  }
  if (typeName === "ZodEffects") {
    return convert(def.schema!);
  }
  if (typeName === "ZodString") {
    return withDesc({ type: "STRING" }, def.description);
  }
  if (typeName === "ZodNumber") {
    return withDesc({ type: "NUMBER" }, def.description);
  }
  if (typeName === "ZodBoolean") {
    return withDesc({ type: "BOOLEAN" }, def.description);
  }
  if (typeName === "ZodEnum") {
    return withDesc(
      { type: "STRING", enum: def.values ?? [] },
      def.description,
    );
  }
  if (typeName === "ZodArray") {
    return withDesc(
      {
        type: "ARRAY",
        items: convert((def.type ?? def.valueType)!),
      },
      def.description,
    );
  }
  if (typeName === "ZodObject") {
    const shape = typeof def.shape === "function" ? def.shape() : {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      if (!isOptional(value)) required.push(key);
    }
    return withDesc(
      {
        type: "OBJECT",
        properties,
        ...(required.length ? { required } : {}),
      },
      def.description,
    );
  }
  if (typeName === "ZodUnion" && def.options) {
    // Prefer first non-null option for Gemini simplicity
    return convert(def.options[0]!);
  }

  return withDesc({ type: "OBJECT", properties: {} }, def.description);
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema._def as { typeName?: string }).typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

function withDesc(
  schema: Record<string, unknown>,
  description?: string,
): Record<string, unknown> {
  if (description) return { ...schema, description };
  return schema;
}
