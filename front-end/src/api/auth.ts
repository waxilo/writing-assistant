import { request } from "./http";
import type { LoginParams, AuthTokens, UserInfo } from "../types/auth";

/** Authenticate a user; resolves to a token pair on success. */
export function login(params: LoginParams): Promise<AuthTokens> {
  return request<AuthTokens>("/login", { method: "POST", body: params });
}

/** Register a new user; resolves to a token pair (auto login). */
export function register(params: LoginParams): Promise<AuthTokens> {
  return request<AuthTokens>("/register", { method: "POST", body: params });
}

/** Revoke the given refresh token server-side (logout). */
export function logout(refreshToken: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/logout", {
    method: "POST",
    body: { refreshToken },
    skipAuthRefresh: true,
  });
}

/** Fetch the currently authenticated user's info. */
export function getMe(): Promise<UserInfo> {
  return request<UserInfo>("/me", { method: "GET" });
}

/** Change the account password (other sessions are kicked). */
export function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/me/password", {
    method: "PUT",
    body: { oldPassword, newPassword },
  });
}
