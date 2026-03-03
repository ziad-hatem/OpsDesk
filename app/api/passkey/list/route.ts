import { NextResponse } from "next/server";
import { listUserPasskeys } from "next-passkey-webauthn/server";
import { createPasskeyServerOptions } from "@/lib/server/passkey-config";
import { resolvePasskeyUserId } from "@/lib/server/passkey-request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { userId?: string };
    const userIdResult = await resolvePasskeyUserId({
      requestedUserId: body.userId,
      requireSession: true,
    });
    if (!userIdResult.ok) {
      return NextResponse.json({ error: userIdResult.error }, { status: userIdResult.status });
    }

    const options = createPasskeyServerOptions();
    const passkeys = await listUserPasskeys(userIdResult.userId, options);
    return NextResponse.json(passkeys, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to list passkeys";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

