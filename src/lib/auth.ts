import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AuthUserSummary = {
  id: string;
  email: string | null;
  phone: string | null;
};

export type AuthSessionState = {
  session: Session | null;
  user: User | null;
};

export type AuthResult = AuthSessionState & {
  message?: string;
};

export function userSummaryFromUser(user: User | null | undefined): AuthUserSummary | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
  };
}

export function friendlyAuthError(error: unknown, fallback = "账号操作失败，请稍后重试"): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (!message) return fallback;
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "邮箱或密码不正确，请重试";
  }
  if (lower.includes("email not confirmed")) {
    return "邮箱尚未验证，请先完成邮箱验证";
  }
  if (lower.includes("user already registered") || lower.includes("already registered")) {
    return "该邮箱已注册，请直接登录";
  }
  if (lower.includes("password")) {
    return "密码不符合要求，请至少输入 8 位";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "无法连接账号服务，请检查网络后重试";
  }
  return fallback;
}

export async function getCurrentSession(): Promise<AuthSessionState> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return {
    session: data.session ?? null,
    user: data.session?.user ?? null,
  };
}

export async function getCurrentUserSummary(): Promise<AuthUserSummary | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return userSummaryFromUser(data.user);
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(error.message);
  return {
    session: data.session ?? null,
    user: data.user ?? data.session?.user ?? null,
  };
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw new Error(error.message);
  return {
    session: data.session ?? null,
    user: data.user ?? data.session?.user ?? null,
    message: data.session ? "注册成功，已登录" : "注册成功，请前往邮箱确认账号后再登录",
  };
}

export async function signOutCurrentSession(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error(error.message);
}

export function subscribeAuthState(
  callback: (event: string, session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}
