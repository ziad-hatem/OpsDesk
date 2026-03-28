import { NextResponse } from "next/server";
import { startRegistration } from "next-passkey-webauthn/server";
import { createPasskeyServerOptions } from "@/lib/server/passkey-config";
import { resolvePasskeyUserId } from "@/lib/server/passkey-request";

export const runtime = "nodejs";

function normalizeOptionalText(value: unknown, maxLength = 255): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      userName?: string;
      userDisplayName?: string;
      timeout?: number;
    };

    const userIdResult = await resolvePasskeyUserId({
      requestedUserId: body.userId,
      requireSession: true,
    });
    if (!userIdResult.ok) {
      return NextResponse.json({ error: userIdResult.error }, { status: userIdResult.status });
    }

    const options = createPasskeyServerOptions();
    const registrationOptions = await startRegistration(
      userIdResult.userId,
      options,
      {
        userName: normalizeOptionalText(body.userName, 320),
        userDisplayName: normalizeOptionalText(body.userDisplayName, 320),
        timeout:
          typeof body.timeout === "number" && Number.isFinite(body.timeout)
            ? body.timeout
            : undefined,
      },
    );

    const authenticatorSelection =
      registrationOptions.authenticatorSelection &&
      typeof registrationOptions.authenticatorSelection === "object"
        ? {
            ...registrationOptions.authenticatorSelection,
          }
        : undefined;

    if (
      authenticatorSelection &&
      "authenticatorAttachment" in authenticatorSelection
    ) {
      delete (authenticatorSelection as Record<string, unknown>)
        .authenticatorAttachment;
    }

    // Allow both on-device and cross-device flows (QR/Bluetooth/security keys).
    const normalizedOptions = {
      ...registrationOptions,
      authenticatorSelection,
      hints: ["hybrid", "client-device", "security-key"],
    };

    return NextResponse.json(normalizedOptions, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to start passkey registration";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
