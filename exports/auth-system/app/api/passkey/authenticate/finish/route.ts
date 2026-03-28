import { NextResponse } from "next/server";
import { finishAuthentication } from "next-passkey-webauthn/server";
import { createPasskeyServerOptions } from "@/lib/server/passkey-config";
import { resolvePasskeyUserId } from "@/lib/server/passkey-request";
import { createPasskeyAssertionToken } from "@/lib/server/passkey-assertion";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      credential?: unknown;
    };

    if (!body.credential) {
      return NextResponse.json({ error: "credential is required" }, { status: 400 });
    }

    const userIdResult = await resolvePasskeyUserId({
      requestedUserId: body.userId,
      requireSession: false,
    });
    if (!userIdResult.ok) {
      return NextResponse.json({ error: userIdResult.error }, { status: userIdResult.status });
    }

    const options = createPasskeyServerOptions();
    const result = await finishAuthentication(
      userIdResult.userId,
      body.credential as never,
      options,
    );

    const assertionToken =
      result.verified && result.credential?.credentialId
        ? createPasskeyAssertionToken({
            userId: userIdResult.userId,
            credentialId: result.credential.credentialId,
          })
        : null;

    return NextResponse.json(
      {
        ...result,
        assertionToken,
      },
      { status: result.verified ? 200 : 400 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to complete passkey authentication";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
