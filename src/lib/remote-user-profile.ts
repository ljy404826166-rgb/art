import type { LocalUserProfile } from "./user-profile";
import { normalizeUserProfile } from "./user-profile";
import { supabase } from "./supabase";

export type RemoteProfileResult = {
  profile: LocalUserProfile | null;
  unavailable: boolean;
  error: string;
};

function isUnavailableProfileError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    text.includes("42p01") ||
    text.includes("pgrst205") ||
    text.includes("schema cache") ||
    text.includes("user_profiles")
  );
}

function fromRemoteProfile(value: Record<string, unknown> | null): LocalUserProfile | null {
  if (!value) return null;
  return normalizeUserProfile({
    displayName: value.display_name,
    bio: value.bio,
    location: value.location,
    website: value.website,
    emailDisplay: "",
    avatarDataUrl: "",
    avatarUrl: value.avatar_url,
    avatarInitials: "",
    updatedAt: value.updated_at,
  });
}

export async function readRemoteUserProfile(userId: string): Promise<RemoteProfileResult> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("display_name, avatar_url, bio, location, website, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return {
      profile: null,
      unavailable: isUnavailableProfileError(error),
      error: error.message,
    };
  }

  return {
    profile: fromRemoteProfile(data),
    unavailable: false,
    error: "",
  };
}

export async function saveRemoteUserProfile(
  userId: string,
  profile: LocalUserProfile,
): Promise<RemoteProfileResult> {
  const normalized = normalizeUserProfile(profile);
  const { data, error } = await supabase
    .from("user_profiles")
    .upsert(
      {
        user_id: userId,
        display_name: normalized.displayName,
        avatar_url: normalized.avatarUrl || null,
        bio: normalized.bio || null,
        location: normalized.location || null,
        website: normalized.website || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("display_name, avatar_url, bio, location, website, updated_at")
    .single();

  if (error) {
    return {
      profile: null,
      unavailable: isUnavailableProfileError(error),
      error: error.message,
    };
  }

  return {
    profile: fromRemoteProfile(data),
    unavailable: false,
    error: "",
  };
}
