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
