import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  createEmailMfaCode,
  hashEmailMfaCode,
  isMultiStepAuthEnabled,
  MFA_EMAIL_CODE_COOLDOWN_SECONDS,
  MFA_EMAIL_CODE_TTL_MINUTES,
} from "@/lib/server/mfa-email-auth";
import { sendMfaEmailCode } from "@/lib/server/mfa-email-code";

export const runtime = "nodejs";

type SendMfaEmailBody = {
  accessToken?: string;
};

type ExistingChallengeRow = {
  user_id: string;
  last_sent_at: string | null;
};

function isMissingMfaTableError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("email_mfa_challenges") &&
    (lowered.includes("does not exist") || lowered.includes("schema cache"))
  );
}

export async function POST(req: Request) {
  let body: SendMfaEmailBody = {};
  try {
    body = (await req.json()) as SendMfaEmailBody;
  } catch {
    body = {};
  }

  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (!accessToken) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    const user = userData.user;

    if (userError || !user?.id || !user.email) {
      return NextResponse.json(
        { error: "Authentication session is invalid or expired" },
        { status: 401 },
      );
    }

    if (!isMultiStepAuthEnabled(user.user_metadata)) {
      return NextResponse.json(
        { error: "Multi-step authentication is not enabled for this account" },
        { status: 400 },
      );
    }

    const { data: existingChallenge, error: existingChallengeError } = await supabase
      .from("email_mfa_challenges")
      .select("user_id, last_sent_at")
      .eq("user_id", user.id)
      .maybeSingle<ExistingChallengeRow>();

    if (existingChallengeError) {
      if (isMissingMfaTableError(existingChallengeError.message)) {
        return NextResponse.json(
          { error: "MFA email storage is not configured. Run db/mfa-email-schema.sql first." },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { error: `Failed to load MFA challenge: ${existingChallengeError.message}` },
        { status: 500 },
      );
    }

    if (existingChallenge?.last_sent_at) {
      const lastSentAtMs = new Date(existingChallenge.last_sent_at).getTime();
      if (Number.isFinite(lastSentAtMs)) {
        const elapsedSeconds = Math.floor((Date.now() - lastSentAtMs) / 1000);
        if (elapsedSeconds < MFA_EMAIL_CODE_COOLDOWN_SECONDS) {
          return NextResponse.json(
            {
              error: `Please wait ${MFA_EMAIL_CODE_COOLDOWN_SECONDS - elapsedSeconds}s before requesting another code.`,
            },
            { status: 429 },
          );
        }
      }
    }

    const code = createEmailMfaCode();
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(
      Date.now() + MFA_EMAIL_CODE_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    const { error: upsertError } = await supabase
      .from("email_mfa_challenges")
      .upsert(
        {
          user_id: user.id,
          code_hash: hashEmailMfaCode(code),
          attempt_count: 0,
          expires_at: expiresAtIso,
          last_sent_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      if (isMissingMfaTableError(upsertError.message)) {
        return NextResponse.json(
          { error: "MFA email storage is not configured. Run db/mfa-email-schema.sql first." },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { error: `Failed to store MFA challenge: ${upsertError.message}` },
        { status: 500 },
      );
    }

    await sendMfaEmailCode({
      toEmail: user.email,
      code,
      expiresInMinutes: MFA_EMAIL_CODE_TTL_MINUTES,
    });

    return NextResponse.json(
      {
        message: "Verification code sent to your email.",
        email: user.email,
        expiresInMinutes: MFA_EMAIL_CODE_TTL_MINUTES,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send MFA verification code";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
