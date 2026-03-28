import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import ResetPasswordEmail from "@/app/emails/ResetPasswordEmail";
import {
  FORGOT_PASSWORD_SUCCESS_MESSAGE,
  normalizeEmail,
} from "@/app/(auth)/forgot-password/forgot-password-flow";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Please provide a valid email address" },
        { status: 400 },
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const supabaseAdmin = createClient(
      getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
        options: {
          redirectTo: `${getRequiredEnv("NEXTAUTH_URL")}/reset-password`,
        },
      });

    if (!linkError && linkData?.properties?.action_link) {
      const resend = new Resend(getRequiredEnv("RESEND_API_KEY"));
      const { error: emailError } = await resend.emails.send({
        from: "OpsDesk <contact@ziadhatem.dev>",
        to: [normalizedEmail],
        subject: "Reset your OpsDesk password",
        react: await ResetPasswordEmail({
          email: normalizedEmail,
          resetLink: linkData.properties.action_link,
        }),
      });

      if (emailError) {
        console.error("Failed to send password reset email:", emailError);
      }
    } else if (linkError) {
      // Keep response generic so account existence cannot be inferred.
      console.error("Password reset link generation failed:", linkError.message);
    }

    return NextResponse.json(
      { message: FORGOT_PASSWORD_SUCCESS_MESSAGE },
      { status: 200 },
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
