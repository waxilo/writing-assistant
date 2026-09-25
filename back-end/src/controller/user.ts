import * as userService from "../service/UserService";
import * as authService from "../service/AuthService";
import { jsonResponse } from "../response";
import type { Ctx } from "../context";

/** Return the authenticated user's info. */
export async function me(ctx: Ctx): Promise<Response> {
  const user = await userService.getUser(ctx.env, ctx.userId);
  return jsonResponse(user);
}

interface ChangePasswordBody {
  oldPassword: string;
  newPassword: string;
}

/** Change the account password (kicks other sessions). */
export async function changePassword(ctx: Ctx): Promise<Response> {
  const body = await ctx.json<ChangePasswordBody>();
  await authService.changePassword(
    ctx.env,
    ctx.userId,
    ctx.userSid,
    body.oldPassword,
    body.newPassword
  );
  return jsonResponse({ ok: true });
}
