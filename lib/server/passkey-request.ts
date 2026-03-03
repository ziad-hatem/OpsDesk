import { auth } from "@/auth";

export async function resolvePasskeyUserId(params: {
  requestedUserId: unknown;
  requireSession: boolean;
}): Promise<
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string }
> {
  const requestedUserId =
    typeof params.requestedUserId === "string"
      ? params.requestedUserId.trim()
      : "";

  if (!requestedUserId) {
    return { ok: false, status: 400, error: "userId is required" };
  }

  const session = await auth();
  const sessionUserId = session?.user?.id?.trim() ?? "";

  if (params.requireSession && !sessionUserId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (sessionUserId && sessionUserId !== requestedUserId) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: userId does not match the current session",
    };
  }

  return { ok: true, userId: requestedUserId };
}

