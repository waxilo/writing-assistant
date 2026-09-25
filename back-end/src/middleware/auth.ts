import { verifyAccess } from "../utils/token";
import type { Ctx } from "../context";

export interface AuthResult {
  success: boolean;
  message?: string;
  userId?: number;
  /** Refresh-session id embedded in the access token (may be absent). */
  sid?: string;
}

/**
 * Stateless auth check: verify the Bearer token's signature and expiry, and
 * return the embedded user id + session id. No database access.
 */
export async function checkAuth(ctx: Ctx): Promise<AuthResult> {
  const header = ctx.request.headers.get("Authorization");
  if (!header) {
    return { success: false, message: "未登录" };
  }

  // Case-insensitive scheme, exactly one space, no leading/trailing junk.
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { success: false, message: "未登录" };
  }
  const result = await verifyAccess(match[1], ctx.env);
  if (!result.success || result.userId === undefined) {
    return { success: false, message: "请重新登录" };
  }

  return { success: true, userId: result.userId, sid: result.sid };
}
