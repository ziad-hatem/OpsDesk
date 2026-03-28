import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import VerificationEmail from "../../../../app/emails/VerificationEmail";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: Request) {
  try {
    const { email, password, firstName, lastName, company } = await req.json();

    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: "Please fill out all required fields" },
        { status: 400 },
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Generate a signup link via the Supabase Admin API to use with Resend
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            company: company || "",
            registered_via_opsdesk: true,
          },
          redirectTo: `${process.env.NEXTAUTH_URL}/login?verified=true`,
        },
      });

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    const verificationLink = linkData.properties.action_link;

    // Try sending email if registration link was generated successfully
    try {
      const { error: emailError } = await resend.emails.send({
        from: "OpsDesk <contact@ziadhatem.dev>",
        to: [email],
        subject: "Verify your OpsDesk account",
        react: await VerificationEmail({ email, firstName, verificationLink }),
      });

      if (emailError) {
        // We log email errors but don't fail the total signup process if just the email failed.
        // For a production app we might queue this or handle it better.
        console.error("Failed to send verification email:", emailError);
      }
    } catch (emailException) {
      console.error("Resend exception:", emailException);
    }

    return NextResponse.json(
      { message: "User created successfully", user: linkData.user },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
