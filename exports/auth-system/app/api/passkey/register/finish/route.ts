import { NextResponse } from "next/server";
import { finishRegistration } from "next-passkey-webauthn/server";
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
      credential?: unknown;
      userName?: string;
      userDisplayName?: string;
      deviceInfo?: unknown;
      managementOptions?: unknown;
    };

    if (!body.credential) {
      return NextResponse.json({ error: "credential is required" }, { status: 400 });
    }

    const userIdResult = await resolvePasskeyUserId({
      requestedUserId: body.userId,
      requireSession: true,
    });
    if (!userIdResult.ok) {
      return NextResponse.json({ error: userIdResult.error }, { status: userIdResult.status });
    }

    const options = createPasskeyServerOptions();
    const result = await finishRegistration(
      userIdResult.userId,
      body.credential as never,
      options,
      {
        userName: normalizeOptionalText(body.userName, 320),
        userDisplayName: normalizeOptionalText(body.userDisplayName, 320),
        deviceInfo:
          body.deviceInfo && typeof body.deviceInfo === "object"
            ? body.deviceInfo
            : undefined,
        managementOptions:
          body.managementOptions && typeof body.managementOptions === "object"
            ? body.managementOptions
            : undefined,
      },
    );

    return NextResponse.json(result, { status: result.verified ? 200 : 400 });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to complete passkey registration";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
