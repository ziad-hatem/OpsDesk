import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import {
  normalizeAutomationActions,
  normalizeAutomationConditions,
} from "@/lib/server/automation-engine";
import type { AutomationEntityType, AutomationRule } from "@/lib/automation/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type RouteContext = {
  params: Promise<{ ruleId: string }>;
};

type MembershipRow = {
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

type AutomationRuleRow = Omit<AutomationRule, "conditions" | "actions"> & {
  conditions: unknown;
  actions: unknown;
};

type UpdateAutomationRuleBody = {
  archived?: boolean;
  isEnabled?: boolean;
};

function isAutomationEntityType(value: unknown): value is AutomationEntityType {
  return value === "ticket" || value === "order";
}

function isMissingAutomationRulesTable(error: { message?: string } | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("automation_rules") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  );
}

async function resolveActorRole(params: {
  supabase: ReturnType<typeof import("@/lib/supabase-admin").createSupabaseAdminClient>;
  activeOrgId: string;
  userId: string;
}): Promise<OrganizationRole | null> {
  const { supabase, activeOrgId, userId } = params;

  const withStatus = await supabase
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .maybeSingle<MembershipRow>();

  if (!withStatus.error) {
    const membership = withStatus.data;
    if (!membership || membership.status === "suspended") {
      return null;
    }
    return membership.role;
  }

  const isMissingStatusColumn = withStatus.error.message
    .toLowerCase()
    .includes("organization_memberships.status");
  if (!isMissingStatusColumn) {
    return null;
  }

  const fallback = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", activeOrgId)
    .eq("user_id", userId)
    .maybeSingle<MembershipFallbackRow>();

  return fallback.data?.role ?? null;
}

async function resolveRuleId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.ruleId?.trim() ?? "";
}

function normalizeRuleRow(row: AutomationRuleRow): AutomationRule {
  return {
    ...row,
    conditions: normalizeAutomationConditions(row.conditions),
    actions: normalizeAutomationActions(row.actions),
  };
}

export async function PATCH(req: Request, context: RouteContext) {
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

  const actorRole = await resolveActorRole({ supabase, activeOrgId, userId });
  if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
    return NextResponse.json(
      { error: "Only admins or managers can update automation rules" },
      { status: 403 },
    );
  }

  const ruleId = await resolveRuleId(context);
  if (!ruleId) {
    return NextResponse.json({ error: "ruleId is required" }, { status: 400 });
  }

  let body: UpdateAutomationRuleBody;
  try {
    body = (await req.json()) as UpdateAutomationRuleBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "isEnabled")) {
    updates.is_enabled = Boolean(body.isEnabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, "archived")) {
    updates.archived_at = body.archived ? new Date().toISOString() : null;
    if (body.archived) {
      updates.is_enabled = false;
    }
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("automation_rules")
    .update(updates)
    .eq("organization_id", activeOrgId)
    .eq("id", ruleId)
    .select(
      "id, organization_id, entity_type, name, description, trigger_event, conditions, actions, is_enabled, archived_at, created_by, created_at, updated_at",
    )
    .maybeSingle<AutomationRuleRow>();

  if (error) {
    if (isMissingAutomationRulesTable(error)) {
      return NextResponse.json(
        {
          error:
            "Automation schema is missing. Run db/automation-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to update automation rule: ${error.message}` },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Automation rule not found" }, { status: 404 });
  }

  if (!isAutomationEntityType(data.entity_type)) {
    return NextResponse.json({ error: "Invalid rule entity type" }, { status: 500 });
  }

  return NextResponse.json({ rule: normalizeRuleRow(data) }, { status: 200 });
}

export async function DELETE(_req: Request, context: RouteContext) {
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

  const actorRole = await resolveActorRole({ supabase, activeOrgId, userId });
  if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
    return NextResponse.json(
      { error: "Only admins or managers can delete automation rules" },
      { status: 403 },
    );
  }

  const ruleId = await resolveRuleId(context);
  if (!ruleId) {
    return NextResponse.json({ error: "ruleId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("automation_rules")
    .delete()
    .eq("organization_id", activeOrgId)
    .eq("id", ruleId);

  if (error) {
    if (isMissingAutomationRulesTable(error)) {
      return NextResponse.json(
        {
          error:
            "Automation schema is missing. Run db/automation-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to delete automation rule: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
