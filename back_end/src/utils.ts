import { randomBytes, randomUUID } from "node:crypto";

export const nowTs = (): number => Date.now();

export const toText = (raw: unknown): string => {
  if (typeof raw === "string") {
    return raw;
  }

  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }

  return String(raw ?? "");
};

export const createSessionId = (): string => {
  if (typeof randomUUID === "function") {
    return randomUUID();
  }
  return randomBytes(8).toString("hex");
};
