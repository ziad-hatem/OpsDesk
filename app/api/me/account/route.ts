import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { ACTIVE_ORG_COOKIE } from "@/lib/topbar/constants";

type DeleteAccountBody = {
  confirmation?: string;
  email?: string;
};

type MembershipRow = {
  organization_id: string;
  role: "admin" | "manager" | "support" | "read_only";
  status?: "active" | "suspended" | null;
};

const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET ?? "avatars";

function isMissingStatusColumnError(message: string): boolean {
  return message.toLowerCase().includes("organization_memberships.status");
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DeleteAccountBody;
  try {
    body = (await req.json()) as DeleteAccountBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const confirmation = body.confirmation?.trim().toUpperCase();
  const email = body.email?.trim().toLowerCase();

  if (confirmation !== "DELETE") {
    return NextResponse.json(
      { error: 'Confirmation must be exactly "DELETE"' },
      { status: 400 },
    );
  }

  if (!email || email !== session.user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Email confirmation does not match your account email" },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseAdminClient();

    const membershipResultWithStatus = await supabase
      .from("organization_memberships")
      .select("organization_id, role, status")
      .eq("user_id", session.user.id)
      .eq("role", "admin")
      .eq("status", "active")
      .returns<MembershipRow[]>();

    const membershipResult = membershipResultWithStatus.error &&
      isMissingStatusColumnError(membershipResultWithStatus.error.message)
      ? await supabase
          .from("organization_memberships")
          .select("organization_id, role")
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .returns<MembershipRow[]>()
      : membershipResultWithStatus;

    if (membershipResult.error) {
      return NextResponse.json(
        { error: `Failed to verify organization ownership: ${membershipResult.error.message}` },
        { status: 500 },
      );
    }

    const adminOrgIds = Array.from(
      new Set((membershipResult.data ?? []).map((row) => row.organization_id)),
    );

    for (const orgId of adminOrgIds) {
      const adminCountResultWithStatus = await supabase
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("role", "admin")
        .eq("status", "active");

      const adminCountResult = adminCountResultWithStatus.error &&
        isMissingStatusColumnError(adminCountResultWithStatus.error.message)
        ? await supabase
            .from("organization_memberships")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("role", "admin")
        : adminCountResultWithStatus;

      if (adminCountResult.error) {
        return NextResponse.json(
          { error: `Failed to validate admin safety checks: ${adminCountResult.error.message}` },
          { status: 500 },
        );
      }

      if ((adminCountResult.count ?? 0) <= 1) {
        return NextResponse.json(
          {
            error:
              "Cannot delete this account because you are the last admin in one of your organizations. Assign another admin first.",
          },
          { status: 409 },
        );
      }
    }

    const nowIso = new Date().toISOString();

    const { error: membershipsDeleteError } = await supabase
      .from("organization_memberships")
      .delete()
      .eq("user_id", session.user.id);
    if (membershipsDeleteError) {
      return NextResponse.json(
        { error: `Failed to remove organization memberships: ${membershipsDeleteError.message}` },
        { status: 500 },
      );
    }

    const { error: notificationsDeleteError } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", session.user.id);
    if (notificationsDeleteError) {
      return NextResponse.json(
        { error: `Failed to remove notifications: ${notificationsDeleteError.message}` },
        { status: 500 },
      );
    }

    const { error: inviteRevokeError } = await supabase
      .from("organization_invites")
      .update({ revoked_at: nowIso })
      .eq("invited_by", session.user.id)
      .is("revoked_at", null)
      .is("accepted_at", null);
    const inviteErrorMessage = inviteRevokeError?.message.toLowerCase() ?? "";
    const canIgnoreInviteError =
      inviteErrorMessage.includes("schema cache") ||
      (inviteErrorMessage.includes("relation") &&
        inviteErrorMessage.includes("does not exist"));
    if (inviteRevokeError && !canIgnoreInviteError) {
      return NextResponse.json(
        { error: `Failed to revoke pending invites: ${inviteRevokeError.message}` },
        { status: 500 },
      );
    }

    const maskedEmail = `deleted+${session.user.id}@deleted.local`;
    const { error: userUpdateError } = await supabase
      .from("users")
      .update({
        name: "Deleted User",
        email: maskedEmail,
        avatar_url: null,
        updated_at: nowIso,
      })
      .eq("id", session.user.id);
    if (userUpdateError) {
      return NextResponse.json(
        { error: `Failed to anonymize profile: ${userUpdateError.message}` },
        { status: 500 },
      );
    }

    const { data: avatarObjects } = await supabase.storage
      .from(AVATAR_BUCKET)
      .list(session.user.id, { limit: 100 });

    if (avatarObjects?.length) {
      const paths = avatarObjects.map((file) => `${session.user.id}/${file.name}`);
      const { error: avatarDeleteError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .remove(paths);
      if (avatarDeleteError) {
        console.warn(`Failed to remove avatar files: ${avatarDeleteError.message}`);
      }
    }

    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(session.user.id);
    if (deleteAuthError) {
      return NextResponse.json(
        { error: `Failed to delete auth account: ${deleteAuthError.message}` },
        { status: 500 },
      );
    }

    const response = NextResponse.json(
      { success: true },
      { status: 200 },
    );
    response.cookies.delete(ACTIVE_ORG_COOKIE);
    return response;
  } catch {
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
