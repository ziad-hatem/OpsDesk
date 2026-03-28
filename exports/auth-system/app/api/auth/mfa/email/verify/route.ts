import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  compareEmailMfaCode,
  isMultiStepAuthEnabled,
  isValidEmailMfaCode,
  MFA_EMAIL_CODE_MAX_ATTEMPTS,
} from "@/lib/server/mfa-email-auth";
import { createMfaAssertionToken } from "@/lib/server/mfa-assertion";

export const runtime = "nodejs";

type VerifyMfaEmailBody = {
  accessToken?: string;
  code?: string;
};

type EmailMfaChallengeRow = {
  user_id: string;
  code_hash: string;
  attempt_count: number;
  expires_at: string;
};

function isMissingMfaTableError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("email_mfa_challenges") &&
    (lowered.includes("does not exist") || lowered.includes("schema cache"))
  );
}

export async function POST(req: Request) {
  let body: VerifyMfaEmailBody = {};
  try {
    body = (await req.json()) as VerifyMfaEmailBody;
  } catch {
    body = {};
  }

  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!accessToken) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }
  if (!isValidEmailMfaCode(code)) {
    return NextResponse.json(
      { error: "Verification code must be 6 digits" },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    const user = userData.user;

    if (userError || !user?.id) {
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

    const { data: challenge, error: challengeError } = await supabase
      .from("email_mfa_challenges")
      .select("user_id, code_hash, attempt_count, expires_at")
      .eq("user_id", user.id)
      .maybeSingle<EmailMfaChallengeRow>();

    if (challengeError) {
      if (isMissingMfaTableError(challengeError.message)) {
        return NextResponse.json(
          { error: "MFA email storage is not configured. Run db/mfa-email-schema.sql first." },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { error: `Failed to load MFA challenge: ${challengeError.message}` },
        { status: 500 },
      );
    }

    if (!challenge) {
      return NextResponse.json(
        { error: "No verification code request was found. Request a new code." },
        { status: 400 },
      );
    }

    const expiresAtMs = new Date(challenge.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      await supabase.from("email_mfa_challenges").delete().eq("user_id", user.id);
      return NextResponse.json(
        { error: "Verification code expired. Request a new code." },
        { status: 400 },
      );
    }

    if ((challenge.attempt_count ?? 0) >= MFA_EMAIL_CODE_MAX_ATTEMPTS) {
      await supabase.from("email_mfa_challenges").delete().eq("user_id", user.id);
      return NextResponse.json(
        { error: "Too many failed attempts. Request a new code." },
        { status: 429 },
      );
    }

    const verified = compareEmailMfaCode(code, challenge.code_hash);
    if (!verified) {
      const nextAttempts = (challenge.attempt_count ?? 0) + 1;
      const { error: attemptUpdateError } = await supabase
        .from("email_mfa_challenges")
        .update({
          attempt_count: nextAttempts,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (attemptUpdateError && !isMissingMfaTableError(attemptUpdateError.message)) {
        return NextResponse.json(
          { error: `Failed to update attempt counter: ${attemptUpdateError.message}` },
          { status: 500 },
        );
      }

      if (nextAttempts >= MFA_EMAIL_CODE_MAX_ATTEMPTS) {
        await supabase.from("email_mfa_challenges").delete().eq("user_id", user.id);
        return NextResponse.json(
          { error: "Too many failed attempts. Request a new code." },
          { status: 429 },
        );
      }

      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 400 },
      );
    }

    const { error: deleteChallengeError } = await supabase
      .from("email_mfa_challenges")
      .delete()
      .eq("user_id", user.id);
    if (deleteChallengeError && !isMissingMfaTableError(deleteChallengeError.message)) {
      return NextResponse.json(
        { error: `Failed to finalize MFA verification: ${deleteChallengeError.message}` },
        { status: 500 },
      );
    }

    const mfaAssertion = createMfaAssertionToken({ userId: user.id });
    return NextResponse.json(
      { verified: true, mfaAssertion },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to verify MFA code";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
