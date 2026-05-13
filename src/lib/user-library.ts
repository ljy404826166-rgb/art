import { supabase } from "./supabase";

const favoriteKey = "artArchive:favorites";
const historyKey = "artArchive:history";

export function localFavoriteIds(): string[] {
  return JSON.parse(localStorage.getItem(favoriteKey) || "[]");
}

export function saveLocalFavoriteIds(ids: string[]): void {
  localStorage.setItem(favoriteKey, JSON.stringify([...new Set(ids)]));
}

export function localHistoryIds(): string[] {
  return JSON.parse(localStorage.getItem(historyKey) || "[]");
}

export function saveLocalHistoryIds(ids: string[]): void {
  localStorage.setItem(historyKey, JSON.stringify([...new Set(ids)].slice(0, 50)));
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export type UserSummary = {
  id: string;
  email: string | null;
  phone: string | null;
};

export async function currentUserSummary(): Promise<UserSummary | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
  };
}

export async function signOutCurrentUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export function clearLocalFavorites(): void {
  localStorage.removeItem(favoriteKey);
}

export function clearLocalHistory(): void {
  localStorage.removeItem(historyKey);
}

export function clearLocalDownloads(): void {
  localStorage.removeItem("artArchive:downloads");
}

export async function syncFavorite(artworkId: string, isFavorite: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  if (isFavorite) {
    const { error } = await supabase.from("user_favorites").upsert(
      { user_id: userId, artwork_id: artworkId },
      { onConflict: "user_id,artwork_id" },
    );
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("artwork_id", artworkId);
  if (error) throw new Error(error.message);
}

export async function recordRemoteHistory(artworkId: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase.from("user_browsing_history").upsert(
    {
      user_id: userId,
      artwork_id: artworkId,
      viewed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,artwork_id" },
  );
  if (error) throw new Error(error.message);
}
