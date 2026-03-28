import { NextResponse } from "next/server";
import { deletePasskey } from "next-passkey-webauthn/server";
import { createPasskeyServerOptions } from "@/lib/server/passkey-config";
import { resolvePasskeyUserId } from "@/lib/server/passkey-request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { userId?: string; credentialId?: string };
    const credentialId =
      typeof body.credentialId === "string" ? body.credentialId.trim() : "";
    if (!credentialId) {
      return NextResponse.json({ error: "credentialId is required" }, { status: 400 });
    }

    const userIdResult = await resolvePasskeyUserId({
      requestedUserId: body.userId,
      requireSession: true,
    });
    if (!userIdResult.ok) {
      return NextResponse.json({ error: userIdResult.error }, { status: userIdResult.status });
    }

    const options = createPasskeyServerOptions();
    await deletePasskey(userIdResult.userId, credentialId, options);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to delete passkey";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

