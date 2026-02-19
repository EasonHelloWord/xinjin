import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export interface State {
  arousal: number;
  valence: number;
  stability: number;
  load: number;
  socialDrain: number;
  intensity: number;
}

const stateSchema = z.object({
  arousal: z.number(),
  valence: z.number(),
  stability: z.number(),
  load: z.number(),
  socialDrain: z.number(),
  intensity: z.number()
});

const partialStateSchema = stateSchema.partial();

const envelopeBaseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  ts: z.number(),
  reqId: z.string().optional()
});

const helloSchema = envelopeBaseSchema.extend({
  type: z.literal("hello"),
  payload: z.object({
    client: z.string(),
    version: z.string()
  })
});

const textInputSchema = envelopeBaseSchema.extend({
  type: z.literal("text_input"),
  payload: z.object({
    text: z.string().min(1),
    sessionId: z.string().optional()
  })
});

const setStateSchema = envelopeBaseSchema.extend({
  type: z.literal("set_state"),
  payload: z.object({
    state: partialStateSchema,
    transitionMs: z.number().nonnegative().optional()
  })
});

const setPresetSchema = envelopeBaseSchema.extend({
  type: z.literal("set_preset"),
  payload: z.object({
    name: z.string().min(1),
    intensity: z.number().optional(),
    transitionMs: z.number().nonnegative().optional()
  })
});

export const clientMessageSchema = z.union([
  helloSchema,
  textInputSchema,
  setStateSchema,
  setPresetSchema
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface ServerMessage<TPayload = Record<string, unknown>> {
  v: 1;
  type: string;
  ts: number;
  reqId?: string;
  payload: TPayload;
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const clampState = (partial: Partial<State>): Partial<State> => {
  const output: Partial<State> = {};
  for (const key of Object.keys(partial) as Array<keyof State>) {
    const value = partial[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = clamp01(value);
    }
  }
  return output;
};

export const normalizeIntensity = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return clamp01(value);
};

export const parseMessage = (
  raw: string
): { ok: true; data: ClientMessage } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON payload" };
  }

  const result = clientMessageSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((issue) => issue.message).join("; ") };
  }

  return { ok: true, data: result.data };
};

export const statePatchOnlySchema = partialStateSchema;
