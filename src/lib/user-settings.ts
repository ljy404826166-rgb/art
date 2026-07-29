import type { AppSettings } from "./app-settings";
import { normalizeSettings } from "./app-settings";
import { supabase } from "./supabase";

export type RemoteSettingsResult = {
  settings: AppSettings | null;
  error: string;
};

export async function readRemoteUserSettings(userId: string): Promise<RemoteSettingsResult> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { settings: null, error: error.message };
  }

  return {
    settings: data?.settings ? normalizeSettings(data.settings) : null,
    error: "",
  };
}

export async function saveRemoteUserSettings(
  userId: string,
  settings: AppSettings,
): Promise<RemoteSettingsResult> {
  const normalized = normalizeSettings(settings);
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      settings: normalized,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return { settings: null, error: error.message };
  }

  return { settings: normalized, error: "" };
}
