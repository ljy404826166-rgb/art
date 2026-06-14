export const appSettingsKey = "artArchive:settings";

export type AppTheme = "system" | "light" | "dark";
export type AppFontSize = "small" | "medium" | "large";
export type AppMotion = "full" | "reduced";
export type DownloadQuality = "standard" | "high" | "original";

export type AppSettings = {
  theme: AppTheme;
  fontSize: AppFontSize;
  motion: AppMotion;
  downloadQuality: DownloadQuality;
  confirmBeforeDownload: boolean;
  saveDownloadHistory: boolean;
  syncFavorites: boolean;
  syncHistory: boolean;
};

export const defaultAppSettings: AppSettings = {
  theme: "system",
  fontSize: "medium",
  motion: "full",
  downloadQuality: "high",
  confirmBeforeDownload: true,
  saveDownloadHistory: true,
  syncFavorites: true,
  syncHistory: true,
};

const themes: AppTheme[] = ["system", "light", "dark"];
const fontSizes: AppFontSize[] = ["small", "medium", "large"];
const motions: AppMotion[] = ["full", "reduced"];
const qualities: DownloadQuality[] = ["standard", "high", "original"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return defaultAppSettings;

  return {
    theme: themes.includes(value.theme as AppTheme) ? (value.theme as AppTheme) : defaultAppSettings.theme,
    fontSize: fontSizes.includes(value.fontSize as AppFontSize)
      ? (value.fontSize as AppFontSize)
      : defaultAppSettings.fontSize,
    motion: motions.includes(value.motion as AppMotion) ? (value.motion as AppMotion) : defaultAppSettings.motion,
    downloadQuality: qualities.includes(value.downloadQuality as DownloadQuality)
      ? (value.downloadQuality as DownloadQuality)
      : defaultAppSettings.downloadQuality,
    confirmBeforeDownload:
      typeof value.confirmBeforeDownload === "boolean"
        ? value.confirmBeforeDownload
        : defaultAppSettings.confirmBeforeDownload,
    saveDownloadHistory:
      typeof value.saveDownloadHistory === "boolean" ? value.saveDownloadHistory : defaultAppSettings.saveDownloadHistory,
    syncFavorites: typeof value.syncFavorites === "boolean" ? value.syncFavorites : defaultAppSettings.syncFavorites,
    syncHistory: typeof value.syncHistory === "boolean" ? value.syncHistory : defaultAppSettings.syncHistory,
  };
}

export function readAppSettings(): AppSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(appSettingsKey) || "null"));
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(appSettingsKey, JSON.stringify(normalized));
  return normalized;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  return saveAppSettings({ ...readAppSettings(), ...patch });
}

export function resetAppSettings(): AppSettings {
  localStorage.setItem(appSettingsKey, JSON.stringify(defaultAppSettings));
  return defaultAppSettings;
}
