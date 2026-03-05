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

const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;
const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET ?? "avatars";
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function extensionFromFile(file: File): string {
  const nameParts = file.name.split(".");
  const extFromName = nameParts.length > 1
    ? sanitizePathSegment(nameParts[nameParts.length - 1]).toLowerCase()
    : "";

  if (extFromName) {
    return extFromName;
  }
  if (file.type === "image/jpeg") {
    return "jpg";
  }
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  if (file.type === "image/gif") {
    return "gif";
  }
  return "img";
}

function storagePathFromPublicUrl(url: string | null, bucket: string): string | null {
  if (!url) {
    return null;
  }

  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const rawPath = url.slice(markerIndex + marker.length).split("?")[0];
  if (!rawPath) {
    return null;
  }

  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form payload. Expected multipart/form-data." },
      { status: 400 },
    );
  }

  const fileInput = formData.get("file");
  if (!(fileInput instanceof File)) {
    return NextResponse.json({ error: "Image file is required" }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(fileInput.type)) {
    return NextResponse.json(
      { error: "Only JPG, PNG, WEBP, and GIF images are allowed" },
      { status: 400 },
    );
  }

  if (fileInput.size <= 0 || fileInput.size > MAX_AVATAR_FILE_BYTES) {
    return NextResponse.json(
      { error: "Image must be between 1 byte and 2MB" },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .eq("id", session.user.id)
      .maybeSingle<UserRow>();

    if (userError) {
      return NextResponse.json(
        { error: `Failed to load profile: ${userError.message}` },
        { status: 500 },
      );
    }

    if (!userRow) {
      const { error: insertError } = await supabase.from("users").insert({
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email,
        avatar_url: normalizeAvatarUrl(session.user.image),
      });

      if (insertError) {
        return NextResponse.json(
          { error: `Failed to initialize user profile: ${insertError.message}` },
          { status: 500 },
        );
      }
    }

    const ext = extensionFromFile(fileInput);
    const path = `${session.user.id}/avatar-${Date.now()}.${ext}`;

    const oldAvatarPath = storagePathFromPublicUrl(userRow?.avatar_url ?? null, AVATAR_BUCKET);
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, fileInput, {
        cacheControl: "3600",
        contentType: fileInput.type,
        upsert: false,
      });

    if (uploadError) {
      const lowered = uploadError.message.toLowerCase();
      if (lowered.includes("bucket") && lowered.includes("not found")) {
        return NextResponse.json(
          {
            error:
              `Avatar bucket "${AVATAR_BUCKET}" was not found. Create it in Supabase Storage and make it public.`,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: `Failed to upload avatar: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(path);
    const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateUserError } = await supabase
      .from("users")
      .update({
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.user.id);

    if (updateUserError) {
      return NextResponse.json(
        { error: `Avatar uploaded but profile update failed: ${updateUserError.message}` },
        { status: 500 },
      );
    }

    const { data: authUserResult } = await supabase.auth.admin.getUserById(session.user.id);
    const currentMetadata =
      authUserResult.user?.user_metadata &&
      typeof authUserResult.user.user_metadata === "object"
        ? { ...authUserResult.user.user_metadata }
        : {};

    const nextMetadata = {
      ...currentMetadata,
      avatar_url: avatarUrl,
    };

    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
      session.user.id,
      { user_metadata: nextMetadata },
    );
    if (authUpdateError) {
      return NextResponse.json(
        { error: `Avatar uploaded but auth metadata update failed: ${authUpdateError.message}` },
        { status: 500 },
      );
    }

    if (oldAvatarPath && oldAvatarPath !== path) {
      const { error: removeError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .remove([oldAvatarPath]);
      if (removeError) {
        console.warn(`Failed to remove old avatar "${oldAvatarPath}": ${removeError.message}`);
      }
    }

    return NextResponse.json(
      {
        avatarUrl,
        storagePath: path,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
  }
}
