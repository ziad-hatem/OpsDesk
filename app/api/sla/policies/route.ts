import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import { getSlaPolicies } from "@/lib/server/sla-engine";
import type { SlaPoliciesResponse } from "@/lib/sla/types";
import { isTicketPriority } from "@/lib/tickets/validation";
import { isOrganizationRole } from "@/lib/team/validation";
import type { OrganizationRole } from "@/lib/topbar/types";

type MembershipRow = {
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

type UpdatePoliciesBody = {
  policies?: Array<{
    priority?: string;
    firstResponseMinutes?: number;
    resolutionMinutes?: number;
    warningMinutes?: number;
    escalationRole?: string;
    autoEscalate?: boolean;
  }>;
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

  let membership: MembershipRow | null = null;
  if (membershipResultWithStatus.error) {
    const isMissingStatusColumn = membershipResultWithStatus.error.message
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

    if (fallbackResult.error || !fallbackResult.data) {
      return null;
    }

    membership = {
      ...fallbackResult.data,
      status: "active",
    };
  } else {
    membership = membershipResultWithStatus.data ?? null;
  }

  if (!membership || membership.status === "suspended") {
    return null;
  }
  return membership.role;
}

export async function GET() {
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

  const policies = await getSlaPolicies(supabase, activeOrgId);
  const payload: SlaPoliciesResponse = {
    activeOrgId,
    currentUserId: userId,
    policies,
  };
  return NextResponse.json(payload, { status: 200 });
}

export async function PATCH(req: Request) {
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
      { error: "Only admins or managers can update SLA policies" },
      { status: 403 },
    );
  }

  let body: UpdatePoliciesBody;
  try {
    body = (await req.json()) as UpdatePoliciesBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const inputPolicies = body.policies ?? [];
  if (!Array.isArray(inputPolicies) || inputPolicies.length === 0) {
    return NextResponse.json(
      { error: "policies array is required" },
      { status: 400 },
    );
  }

  const upsertRows: Array<{
    organization_id: string;
    priority: string;
    first_response_minutes: number;
    resolution_minutes: number;
    warning_minutes: number;
    escalation_role: OrganizationRole;
    auto_escalate: boolean;
  }> = [];

  for (const policy of inputPolicies) {
    const priorityValue = policy?.priority;
    if (!policy || typeof priorityValue !== "string" || !isTicketPriority(priorityValue)) {
      return NextResponse.json(
        { error: "Each policy must include a valid ticket priority" },
        { status: 400 },
      );
    }

    const firstResponseMinutes = Number(policy.firstResponseMinutes);
    const resolutionMinutes = Number(policy.resolutionMinutes);
    const warningMinutes = Number(policy.warningMinutes);
    const escalationRole = policy.escalationRole;
    const autoEscalate = Boolean(policy.autoEscalate);

    if (
      !Number.isFinite(firstResponseMinutes) ||
      !Number.isInteger(firstResponseMinutes) ||
      firstResponseMinutes <= 0
    ) {
      return NextResponse.json(
        { error: `Invalid firstResponseMinutes for ${policy.priority}` },
        { status: 400 },
      );
    }

    if (
      !Number.isFinite(resolutionMinutes) ||
      !Number.isInteger(resolutionMinutes) ||
      resolutionMinutes <= 0
    ) {
      return NextResponse.json(
        { error: `Invalid resolutionMinutes for ${policy.priority}` },
        { status: 400 },
      );
    }

    if (
      !Number.isFinite(warningMinutes) ||
      !Number.isInteger(warningMinutes) ||
      warningMinutes < 0
    ) {
      return NextResponse.json(
        { error: `Invalid warningMinutes for ${policy.priority}` },
        { status: 400 },
      );
    }

    if (!isOrganizationRole(escalationRole)) {
      return NextResponse.json(
        { error: `Invalid escalationRole for ${policy.priority}` },
        { status: 400 },
      );
    }

    upsertRows.push({
      organization_id: activeOrgId,
      priority: priorityValue,
      first_response_minutes: firstResponseMinutes,
      resolution_minutes: resolutionMinutes,
      warning_minutes: warningMinutes,
      escalation_role: escalationRole,
      auto_escalate: autoEscalate,
    });
  }

  const { error: upsertError } = await supabase
    .from("sla_policies")
    .upsert(upsertRows, { onConflict: "organization_id,priority" });

  if (upsertError) {
    return NextResponse.json(
      { error: `Failed to save SLA policies: ${upsertError.message}` },
      { status: 500 },
    );
  }

  const policies = await getSlaPolicies(supabase, activeOrgId);
  const payload: SlaPoliciesResponse = {
    activeOrgId,
    currentUserId: userId,
    policies,
  };
  return NextResponse.json(payload, { status: 200 });
}
