import { describe, expect, it } from "vitest";
import {
  parseModelParamsSchema,
  parseModelParamValues,
  stripInvalidParams,
} from "@/features/agents/utils/modelParamsSchema";

const SAMPLE_SCHEMA = JSON.stringify({
  temperature: { type: "number", minimum: 0, maximum: 1, step: 0.05 },
  top_p: { type: "number", minimum: 0, maximum: 1, step: 0.05 },
  max_tokens: { type: "integer", minimum: 1, maximum: 126000, default: 8192 },
  reasoning_effort: { type: "enum", enum: ["off", "low", "medium", "high"], default: "off" },
  provider_options: { top_k: { type: "integer", minimum: 1 } },
});

describe("parseModelParamsSchema", () => {
  it("returns null for empty input", () => {
    expect(parseModelParamsSchema("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseModelParamsSchema("{not json")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseModelParamsSchema("[1, 2]")).toBeNull();
    expect(parseModelParamsSchema('"temperature"')).toBeNull();
  });

  it("returns null when no knobs are present", () => {
    expect(parseModelParamsSchema("{}")).toBeNull();
  });

  it("parses knobs and provider options", () => {
    const schema = parseModelParamsSchema(SAMPLE_SCHEMA);
    expect(schema).not.toBeNull();
    expect(Object.keys(schema!.params)).toEqual([
      "temperature",
      "top_p",
      "max_tokens",
      "reasoning_effort",
    ]);
    expect(schema!.params.temperature).toEqual({
      type: "number",
      minimum: 0,
      maximum: 1,
      step: 0.05,
      default: undefined,
    });
    expect(schema!.params.max_tokens).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 126000,
      step: undefined,
      default: 8192,
    });
    expect(schema!.params.reasoning_effort).toEqual({
      type: "enum",
      enum: ["off", "low", "medium", "high"],
      default: "off",
    });
    expect(schema!.providerOptions).toEqual({
      top_k: {
        type: "integer",
        minimum: 1,
        maximum: undefined,
        step: undefined,
        default: undefined,
      },
    });
  });

  it("skips specs with unknown types and keeps the rest", () => {
    const schema = parseModelParamsSchema(
      JSON.stringify({
        temperature: { type: "number", minimum: 0, maximum: 2 },
        mystery: { type: "vector", dimensions: 3 },
      }),
    );
    expect(schema).not.toBeNull();
    expect(Object.keys(schema!.params)).toEqual(["temperature"]);
  });

  it("skips enum specs without string members", () => {
    expect(
      parseModelParamsSchema(
        JSON.stringify({
          effort: { type: "enum", enum: [] },
        }),
      ),
    ).toBeNull();
  });

  it("ignores a non-object provider_options entry", () => {
    const schema = parseModelParamsSchema(
      JSON.stringify({
        temperature: { type: "number", minimum: 0, maximum: 1 },
        provider_options: "nope",
      }),
    );
    expect(schema).not.toBeNull();
    expect(schema!.providerOptions).toEqual({});
  });
});

describe("parseModelParamValues", () => {
  it("returns an empty object for empty, invalid, or non-object input", () => {
    expect(parseModelParamValues("")).toEqual({});
    expect(parseModelParamValues("{oops")).toEqual({});
    expect(parseModelParamValues("[1]")).toEqual({});
  });

  it("parses a saved values object", () => {
    expect(
      parseModelParamValues('{"temperature": 0.7, "provider_options": {"top_k": 40}}'),
    ).toEqual({
      temperature: 0.7,
      provider_options: { top_k: 40 },
    });
  });
});

describe("stripInvalidParams", () => {
  const schema = parseModelParamsSchema(SAMPLE_SCHEMA);

  it("returns an empty object when the schema is null", () => {
    expect(stripInvalidParams(null, { temperature: 0.5 })).toEqual({});
  });

  it("keeps values that validate", () => {
    const values = {
      temperature: 0.7,
      max_tokens: 4096,
      reasoning_effort: "high",
      provider_options: { top_k: 40 },
    };
    expect(stripInvalidParams(schema, values)).toEqual(values);
  });

  it("drops unknown knobs", () => {
    expect(stripInvalidParams(schema, { temperature: 0.5, frequency_penalty: 1 })).toEqual({
      temperature: 0.5,
    });
  });

  it("drops out-of-bounds numbers", () => {
    expect(stripInvalidParams(schema, { temperature: 1.5, top_p: -0.1, max_tokens: 4096 })).toEqual(
      {
        max_tokens: 4096,
      },
    );
  });

  it("drops non-integer values for integer knobs", () => {
    expect(stripInvalidParams(schema, { max_tokens: 4096.5 })).toEqual({});
  });

  it("drops enum members the schema does not list", () => {
    expect(stripInvalidParams(schema, { reasoning_effort: "max" })).toEqual({});
  });

  it("drops wrong-typed values", () => {
    expect(stripInvalidParams(schema, { temperature: "hot", reasoning_effort: 2 })).toEqual({});
  });

  it("drops unknown provider options and omits the empty group", () => {
    expect(stripInvalidParams(schema, { provider_options: { logit_bias: 1, top_k: 0 } })).toEqual(
      {},
    );
    expect(stripInvalidParams(schema, { provider_options: { top_k: 5, logit_bias: 1 } })).toEqual({
      provider_options: { top_k: 5 },
    });
  });

  it("validates booleans against boolean specs", () => {
    const boolSchema = parseModelParamsSchema(
      JSON.stringify({
        parallel_tool_calls: { type: "boolean", default: true },
      }),
    );
    expect(stripInvalidParams(boolSchema, { parallel_tool_calls: false })).toEqual({
      parallel_tool_calls: false,
    });
    expect(stripInvalidParams(boolSchema, { parallel_tool_calls: "yes" })).toEqual({});
  });
});
