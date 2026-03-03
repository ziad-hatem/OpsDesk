import { NextResponse } from "next/server";
import { startAuthentication } from "next-passkey-webauthn/server";
import { createPasskeyServerOptions } from "@/lib/server/passkey-config";
import { resolvePasskeyUserId } from "@/lib/server/passkey-request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      timeout?: number;
      userVerification?: "required" | "preferred" | "discouraged";
    };

    const userIdResult = await resolvePasskeyUserId({
      requestedUserId: body.userId,
      requireSession: false,
    });
    if (!userIdResult.ok) {
      return NextResponse.json({ error: userIdResult.error }, { status: userIdResult.status });
    }

    const options = createPasskeyServerOptions();
    const authOptions = await startAuthentication(userIdResult.userId, options, {
      timeout:
        typeof body.timeout === "number" && Number.isFinite(body.timeout)
          ? body.timeout
          : undefined,
      userVerification: body.userVerification ?? "preferred",
    });

    const normalizedOptions = {
      ...authOptions,
      hints: ["hybrid", "client-device", "security-key"],
    };

    return NextResponse.json(normalizedOptions, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start passkey authentication";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
