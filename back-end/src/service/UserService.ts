import type { UserInfo, UserRow } from "../types";
import { ApiError } from "../errors";

/** Fetch the current user's public info (no password). Throws if missing. */
export async function getUser(env: Env, userId: number): Promise<UserInfo> {
  const row = await env.DB.prepare(
    `select id, username, nickname, avatar from t_user where id = ?`
  )
    .bind(userId)
    .first<Pick<UserRow, "id" | "username" | "nickname" | "avatar">>();

  if (!row) throw new ApiError(404, "用户不存在");

  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar: row.avatar,
  };
}
