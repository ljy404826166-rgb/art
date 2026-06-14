export const userProfileKey = "artArchive:profile";

export const profileLimits = {
  displayNameMin: 1,
  displayNameMax: 24,
  bioMax: 120,
  locationMax: 40,
  websiteMax: 80,
  emailDisplayMax: 80,
  avatarMaxBytes: 1024 * 1024,
  avatarMimeTypes: ["image/jpeg", "image/png", "image/webp"],
} as const;

export type LocalUserProfile = {
  displayName: string;
  bio: string;
  location: string;
  website: string;
  emailDisplay: string;
  avatarDataUrl: string;
  avatarUrl: string;
  avatarInitials: string;
  updatedAt: string;
};

export const defaultUserProfile: LocalUserProfile = {
  displayName: "林熙和",
  bio: "收藏、浏览和整理我的艺术档案。",
  location: "",
  website: "",
  emailDisplay: "lin.xihe@curatorial.art",
  avatarDataUrl: "",
  avatarUrl: "",
  avatarInitials: "林",
  updatedAt: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function limitText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function initialsFromName(value: string): string {
  const text = value.trim();
  if (!text) return defaultUserProfile.avatarInitials;
  return Array.from(text).slice(0, 2).join("");
}

export function normalizeUserProfile(value: unknown): LocalUserProfile {
  if (!isRecord(value)) return defaultUserProfile;
  const displayName = limitText(value.displayName, profileLimits.displayNameMax) || defaultUserProfile.displayName;

  return {
    displayName,
    bio: limitText(value.bio, profileLimits.bioMax),
    location: limitText(value.location, profileLimits.locationMax),
    website: limitText(value.website, profileLimits.websiteMax),
    emailDisplay: limitText(value.emailDisplay, profileLimits.emailDisplayMax),
    avatarDataUrl: String(value.avatarDataUrl || ""),
    avatarUrl: String(value.avatarUrl || value.avatar_url || ""),
    avatarInitials: limitText(value.avatarInitials, 2) || initialsFromName(displayName),
    updatedAt: String(value.updatedAt || ""),
  };
}

export function readUserProfile(): LocalUserProfile {
  try {
    return normalizeUserProfile(JSON.parse(localStorage.getItem(userProfileKey) || "null"));
  } catch {
    return defaultUserProfile;
  }
}

export function saveUserProfile(profile: LocalUserProfile): LocalUserProfile {
  const normalized = normalizeUserProfile({
    ...profile,
    updatedAt: new Date().toISOString(),
  });
  localStorage.setItem(userProfileKey, JSON.stringify(normalized));
  return normalized;
}

export function resetUserProfile(): LocalUserProfile {
  localStorage.setItem(userProfileKey, JSON.stringify(defaultUserProfile));
  return defaultUserProfile;
}
