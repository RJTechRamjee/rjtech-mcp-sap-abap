import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`.
 * MCP_API_KEY may hold several comma-separated keys so a key can be rotated without downtime.
 */
export function apiKeyAuth(keysSetting: string) {
  const keys = keysSetting
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map(digest);

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    const provided = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : req.get("x-api-key")?.trim();

    // Comparing fixed-length hashes keeps the check constant-time regardless of key length.
    if (provided && keys.some((key) => timingSafeEqual(key, digest(provided)))) {
      return next();
    }
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="mcp"')
      .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: missing or invalid API key" }, id: null });
  };
}
