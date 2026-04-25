import { ANCHOR_STATES } from "../avatar/avatarConfig.js";

export const assistantDirectiveSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "reply", "animation", "meta"],
  properties: {
    version: { type: "string", const: "1.0" },
    reply: {
      type: "object",
      additionalProperties: false,
      required: ["text", "language", "address_user_as"],
      properties: {
        text: { type: "string" },
        language: { type: "string", enum: ["zh", "en"] },
        address_user_as: { type: "string", enum: ["老板", "Boss"] }
      }
    },
    animation: {
      type: "object",
      additionalProperties: false,
      required: ["semantic_intent", "target_state", "tone", "should_hold"],
      properties: {
        semantic_intent: {
          type: "string",
          enum: ["welcome", "smalltalk", "explain", "instruction", "praise", "empathy", "clarify", "close"]
        },
        target_state: {
          type: "string",
          enum: ANCHOR_STATES
        },
        tone: {
          type: "string",
          enum: ["neutral", "calm_supportive", "warm_light", "gentle_concern", "light_positive"]
        },
        should_hold: { type: "boolean" }
      }
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["persona_version", "schema_version", "uncertainty_note"],
      properties: {
        persona_version: { type: "string" },
        schema_version: { type: "string", const: "assistant_directive_v1" },
        uncertainty_note: { type: "string" }
      }
    }
  }
} as const;
