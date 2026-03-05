import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizeAvatarUrl } from "@/lib/avatar-url";

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
};

type ProfileMetadata = {
  phone: string | null;
  title: string | null;
  department: string | null;
  bio: string | null;
  timezone: string | null;
  multiStepAuthEnabled: boolean;
};

type UpdateProfileBody = {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  phone?: string | null;
  title?: string | null;
  department?: string | null;
  bio?: string | null;
  timezone?: string | null;
  multiStepAuthEnabled?: boolean;
  newPassword?: string;
};

function normalizeOptionalText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized.length) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizeOptionalText(value, 320);
  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowered);
  return isValid ? lowered : null;
}

function readProfileMetadata(metadata: unknown): ProfileMetadata {
  const record = metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};

  return {
    phone: normalizeOptionalText(record.phone, 60),
    title: normalizeOptionalText(record.title, 120),
    department: normalizeOptionalText(record.department, 120),
    bio: normalizeOptionalText(record.bio, 2000),
    timezone: normalizeOptionalText(record.timezone, 80),
    multiStepAuthEnabled: record.multi_step_auth_enabled === true,
  };
}

async function ensureUserRow(params: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  fallbackName: string | null;
  fallbackEmail: string;
  fallbackAvatarUrl: string | null;
}): Promise<{ user: UserRow | null; error: string | null }> {
  const { supabase, userId, fallbackName, fallbackEmail, fallbackAvatarUrl } = params;
  const safeFallbackAvatarUrl = normalizeAvatarUrl(fallbackAvatarUrl);

  const { data: existingUser, error: existingUserError } = await supabase
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle<UserRow>();

  if (existingUserError) {
    return {
      user: null,
      error: `Failed to load profile: ${existingUserError.message}`,
    };
  }

  if (existingUser) {
    return {
      user: existingUser,
      error: null,
    };
  }

  const { error: insertError } = await supabase.from("users").insert({
    id: userId,
    name: fallbackName,
    email: fallbackEmail,
    avatar_url: safeFallbackAvatarUrl,
  });

  if (insertError) {
    return {
      user: null,
      error: `Failed to initialize user profile: ${insertError.message}`,
    };
  }

  const { data: createdUser, error: createdUserError } = await supabase
    .from("users")
    .select("id, name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle<UserRow>();

  if (createdUserError || !createdUser) {
    return {
      user: null,
      error:
        createdUserError?.message ??
        "Profile initialized but failed to fetch user row",
    };
  }

  return {
    user: createdUser,
    error: null,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: authUserResult, error: authUserError } =
      await supabase.auth.admin.getUserById(session.user.id);

    if (authUserError) {
      return NextResponse.json(
        { error: `Failed to load auth profile: ${authUserError.message}` },
        { status: 500 },
      );
    }

    const ensured = await ensureUserRow({
      supabase,
      userId: session.user.id,
      fallbackName: session.user.name ?? null,
      fallbackEmail: session.user.email,
      fallbackAvatarUrl: session.user.image ?? null,
    });

    if (!ensured.user) {
      return NextResponse.json({ error: ensured.error }, { status: 500 });
    }

    const metadata = readProfileMetadata(authUserResult.user?.user_metadata);

    return NextResponse.json(
      {
        user: ensured.user,
        profile: metadata,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: UpdateProfileBody;
  try {
    body = (await req.json()) as UpdateProfileBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
  const hasAvatarUrl = Object.prototype.hasOwnProperty.call(body, "avatarUrl");
  const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasDepartment = Object.prototype.hasOwnProperty.call(body, "department");
  const hasBio = Object.prototype.hasOwnProperty.call(body, "bio");
  const hasTimezone = Object.prototype.hasOwnProperty.call(body, "timezone");
  const hasMultiStepAuthEnabled = Object.prototype.hasOwnProperty.call(
    body,
    "multiStepAuthEnabled",
  );
  const hasNewPassword = Object.prototype.hasOwnProperty.call(body, "newPassword");

  if (
    !hasName &&
    !hasEmail &&
    !hasAvatarUrl &&
    !hasPhone &&
    !hasTitle &&
    !hasDepartment &&
    !hasBio &&
    !hasTimezone &&
    !hasMultiStepAuthEnabled &&
    !hasNewPassword
  ) {
    return NextResponse.json({ error: "No profile fields to update" }, { status: 400 });
  }

  const name = hasName ? normalizeOptionalText(body.name, 150) : null;
  const email = hasEmail ? normalizeEmail(body.email) : null;
  const avatarUrlInput = hasAvatarUrl ? body.avatarUrl : undefined;
  const avatarUrl = hasAvatarUrl ? normalizeAvatarUrl(avatarUrlInput) : null;
  const phone = hasPhone ? normalizeOptionalText(body.phone, 60) : null;
  const title = hasTitle ? normalizeOptionalText(body.title, 120) : null;
  const department = hasDepartment
    ? normalizeOptionalText(body.department, 120)
    : null;
  const bio = hasBio ? normalizeOptionalText(body.bio, 2000) : null;
  const timezone = hasTimezone ? normalizeOptionalText(body.timezone, 80) : null;
  const multiStepAuthEnabled = hasMultiStepAuthEnabled
    ? body.multiStepAuthEnabled === true
      ? true
      : body.multiStepAuthEnabled === false
        ? false
        : null
    : null;
  const newPassword = hasNewPassword ? normalizeOptionalText(body.newPassword, 200) : null;

  if (hasEmail && !email) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  if (hasAvatarUrl) {
    const wantsClearAvatar =
      avatarUrlInput === null ||
      (typeof avatarUrlInput === "string" && avatarUrlInput.trim().length === 0);
    if (!wantsClearAvatar && !avatarUrl) {
      return NextResponse.json(
        { error: "Avatar URL must be a valid HTTP(S) image URL" },
        { status: 400 },
      );
    }
  }

  if (hasNewPassword && (!newPassword || newPassword.length < 8)) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters long" },
      { status: 400 },
    );
  }

  if (hasMultiStepAuthEnabled && multiStepAuthEnabled === null) {
    return NextResponse.json(
      { error: "multiStepAuthEnabled must be a boolean" },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();

    const ensured = await ensureUserRow({
      supabase,
      userId: session.user.id,
      fallbackName: session.user.name ?? null,
      fallbackEmail: session.user.email,
      fallbackAvatarUrl: session.user.image ?? null,
    });

    if (!ensured.user) {
      return NextResponse.json({ error: ensured.error }, { status: 500 });
    }

    const { data: authUserResult, error: authUserError } =
      await supabase.auth.admin.getUserById(session.user.id);
    if (authUserError) {
      return NextResponse.json(
        { error: `Failed to load auth profile: ${authUserError.message}` },
        { status: 500 },
      );
    }

    const currentMetadata =
      authUserResult.user?.user_metadata &&
      typeof authUserResult.user.user_metadata === "object"
        ? { ...authUserResult.user.user_metadata }
        : {};

    const nextMetadata = { ...currentMetadata } as Record<string, unknown>;
    if (hasAvatarUrl) {
      nextMetadata.avatar_url = avatarUrl;
    }
    if (hasName) {
      nextMetadata.name = name;
    }
    if (hasPhone) {
      nextMetadata.phone = phone;
    }
    if (hasTitle) {
      nextMetadata.title = title;
    }
    if (hasDepartment) {
      nextMetadata.department = department;
    }
    if (hasBio) {
      nextMetadata.bio = bio;
    }
    if (hasTimezone) {
      nextMetadata.timezone = timezone;
    }
    if (hasMultiStepAuthEnabled && multiStepAuthEnabled !== null) {
      nextMetadata.multi_step_auth_enabled = multiStepAuthEnabled;
    }

    const authUpdates: {
      email?: string;
      password?: string;
      user_metadata?: Record<string, unknown>;
    } = {};
    if (hasEmail && email) {
      authUpdates.email = email;
    }
    if (hasNewPassword && newPassword) {
      authUpdates.password = newPassword;
    }
    if (
      hasAvatarUrl ||
      hasName ||
      hasPhone ||
      hasTitle ||
      hasDepartment ||
      hasBio ||
      hasTimezone ||
      hasMultiStepAuthEnabled
    ) {
      authUpdates.user_metadata = nextMetadata;
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
        session.user.id,
        authUpdates,
      );

      if (authUpdateError) {
        const lowered = authUpdateError.message.toLowerCase();
        if (lowered.includes("already registered") || lowered.includes("duplicate")) {
          return NextResponse.json(
            { error: "This email is already used by another account" },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { error: `Failed to update auth profile: ${authUpdateError.message}` },
          { status: 500 },
        );
      }
    }

    const userUpdates: { name?: string | null; email?: string; avatar_url?: string | null; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (hasName) {
      userUpdates.name = name;
    }
    if (hasEmail && email) {
      userUpdates.email = email;
    }
    if (hasAvatarUrl) {
      userUpdates.avatar_url = avatarUrl;
    }

    const { error: profileUpdateError } = await supabase
      .from("users")
      .update(userUpdates)
      .eq("id", session.user.id);

    if (profileUpdateError) {
      const lowered = profileUpdateError.message.toLowerCase();
      if (lowered.includes("duplicate")) {
        return NextResponse.json(
          { error: "This email is already used by another account" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: `Failed to update profile: ${profileUpdateError.message}` },
        { status: 500 },
      );
    }

    const { data: updatedUser, error: updatedUserError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .eq("id", session.user.id)
      .single<UserRow>();

    if (updatedUserError || !updatedUser) {
      return NextResponse.json(
        {
          error: `Profile updated but failed to fetch latest user: ${
            updatedUserError?.message ?? "Unknown error"
          }`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        user: updatedUser,
        profile: {
          phone: hasPhone ? phone : readProfileMetadata(nextMetadata).phone,
          title: hasTitle ? title : readProfileMetadata(nextMetadata).title,
          department: hasDepartment
            ? department
            : readProfileMetadata(nextMetadata).department,
          bio: hasBio ? bio : readProfileMetadata(nextMetadata).bio,
          timezone: hasTimezone ? timezone : readProfileMetadata(nextMetadata).timezone,
          multiStepAuthEnabled:
            hasMultiStepAuthEnabled && multiStepAuthEnabled !== null
              ? multiStepAuthEnabled
              : readProfileMetadata(nextMetadata).multiStepAuthEnabled,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
