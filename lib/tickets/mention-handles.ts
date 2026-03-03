export interface MentionHandleIdentity {
  name: string | null;
  email: string;
}

function sanitizeNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeMentionHandle(value: string): string {
  return value.trim().toLowerCase();
}

export function extractMentionHandlesFromText(input: string): string[] {
  const handles = new Set<string>();
  const pattern = /(^|[\s([{\-])@([a-zA-Z0-9][a-zA-Z0-9._-]{1,63})\b/g;

  let match: RegExpExecArray | null = pattern.exec(input);
  while (match) {
    const raw = match[2];
    if (raw) {
      handles.add(normalizeMentionHandle(raw));
    }
    match = pattern.exec(input);
  }

  return Array.from(handles).slice(0, 30);
}

export function buildMentionHandlesForIdentity(
  identity: MentionHandleIdentity,
): string[] {
  const handles = new Set<string>();
  const emailLower = identity.email.toLowerCase();
  const [localPart] = emailLower.split("@");
  if (localPart) {
    handles.add(localPart);
  }

  const name = identity.name?.trim().toLowerCase() ?? "";
  if (name) {
    const dotted = name.replace(/\s+/g, ".");
    const underscored = name.replace(/\s+/g, "_");
    const dashed = name.replace(/\s+/g, "-");
    handles.add(dotted);
    handles.add(underscored);
    handles.add(dashed);

    const parts = name
      .split(/\s+/)
      .map(sanitizeNamePart)
      .filter((part) => part.length >= 2);

    for (const part of parts) {
      handles.add(part);
    }
    if (parts.length >= 2) {
      handles.add(`${parts[0]}.${parts[1]}`);
      handles.add(`${parts[0]}_${parts[1]}`);
      handles.add(`${parts[0]}-${parts[1]}`);
      handles.add(parts.join(""));
    }
  }

  return Array.from(
    new Set(
      Array.from(handles)
        .map(normalizeMentionHandle)
        .filter((handle) => handle.length >= 2),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

