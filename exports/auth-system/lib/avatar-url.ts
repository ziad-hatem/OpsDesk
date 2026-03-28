const GOOGLE_AVATAR_TOKEN_PATTERN = /^[A-Za-z0-9_-]+=s\d+-c$/;

function normalizeAbsoluteHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeGoogleAvatarToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (GOOGLE_AVATAR_TOKEN_PATTERN.test(trimmed)) {
    return `https://lh3.googleusercontent.com/a/${trimmed}`;
  }

  const pathMatch = trimmed.match(/^\/?a\/([A-Za-z0-9_-]+=s\d+-c)$/);
  if (pathMatch?.[1]) {
    return `https://lh3.googleusercontent.com/a/${pathMatch[1]}`;
  }

  return null;
}

export function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const googleAvatar = normalizeGoogleAvatarToken(trimmed);
  if (googleAvatar) {
    return googleAvatar;
  }

  if (trimmed.startsWith("//")) {
    return normalizeAbsoluteHttpUrl(`https:${trimmed}`);
  }

  return normalizeAbsoluteHttpUrl(trimmed);
}

