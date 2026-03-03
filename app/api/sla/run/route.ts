import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { runSlaEscalationEngine } from "@/lib/server/sla-engine";
import type { OrganizationRole } from "@/lib/topbar/types";
import type { SlaRunEscalationResult } from "@/lib/sla/types";

type MembershipRow = {
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

type RunSlaBody = {
  ticketId?: string;
};

async function resolveActorRole(params: {
  userId: string;
  activeOrgId: string;
  supabase: ReturnType<typeof import("@/lib/supabase-admin").createSupabaseAdminClient>;
}): Promise<OrganizationRole | null> {
  const { userId, activeOrgId, supabase } = params;

  const membershipResultWithStatus = await supabase
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();

  if (!membershipResultWithStatus.error && membershipResultWithStatus.data) {
    if (membershipResultWithStatus.data.status !== "suspended") {
      return membershipResultWithStatus.data.role;
    }
    return null;
  }

  const isMissingStatusColumn =
    Boolean(membershipResultWithStatus.error) &&
    membershipResultWithStatus.error?.message
      .toLowerCase()
      .includes("organization_memberships.status");

  if (!isMissingStatusColumn) {
    return null;
  }

  const fallbackResult = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .maybeSingle<MembershipFallbackRow>();

  return fallbackResult.data?.role ?? null;
}

export async function POST(req: Request) {
  const ctxResult = await getTicketRequestContext();
  if (!ctxResult.ok) {
    return NextResponse.json({ error: ctxResult.error }, { status: ctxResult.status });
  }

  const { supabase, activeOrgId, userId } = ctxResult.context;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization selected. Create or join an organization first." },
      { status: 400 },
    );
  }

  const actorRole = await resolveActorRole({ userId, activeOrgId, supabase });
  if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
    return NextResponse.json(
      { error: "Only admins or managers can run SLA escalation" },
      { status: 403 },
    );
  }

  let body: RunSlaBody = {};
  try {
    body = (await req.json()) as RunSlaBody;
  } catch {
    // Keep body empty.
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
  const result = await runSlaEscalationEngine({
    supabase,
    organizationId: activeOrgId,
    actorUserId: userId,
    ticketId: ticketId || null,
  });

  const payload: SlaRunEscalationResult = {
    activeOrgId,
    scanned: result.scanned,
    warningsCreated: result.warningsCreated,
    breachesCreated: result.breachesCreated,
    autoEscalations: result.autoEscalations,
  };

  return NextResponse.json(payload, { status: 200 });
}
