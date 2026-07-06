import { createHash, randomBytes } from "crypto";

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

