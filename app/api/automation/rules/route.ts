import { NextResponse } from "next/server";
import { getTicketRequestContext } from "@/lib/server/ticket-context";
import {
  getAutomationRules,
  isAutomationTriggerEvent,
  normalizeAutomationActions,
  normalizeAutomationConditions,
} from "@/lib/server/automation-engine";
import type { AutomationRulesResponse } from "@/lib/automation/types";
import type { OrganizationRole } from "@/lib/topbar/types";

type MembershipRow = {
  role: OrganizationRole;
  status?: "active" | "suspended" | null;
};

type MembershipFallbackRow = Omit<MembershipRow, "status">;

type UpsertRulesBody = {
  rules?: Array<{
    id?: string;
    name?: string;
    description?: string | null;
    triggerEvent?: string;
    conditions?: unknown;
    actions?: unknown;
    isEnabled?: boolean;
  }>;
};

type ExistingRuleIdRow = {
  id: string;
};

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 100);
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 500);
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

  const rules = await getAutomationRules(supabase, activeOrgId, userId);
  const payload: AutomationRulesResponse = {
    activeOrgId,
    currentUserId: userId,
    rules,
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

  const actorRole = await resolveActorRole({ supabase, activeOrgId, userId });
  if (!actorRole || (actorRole !== "admin" && actorRole !== "manager")) {
    return NextResponse.json(
      { error: "Only admins or managers can update automation rules" },
      { status: 403 },
    );
  }

  let body: UpsertRulesBody;
  try {
    body = (await req.json()) as UpsertRulesBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const inputRules = body.rules ?? [];
  if (!Array.isArray(inputRules) || inputRules.length === 0) {
    return NextResponse.json(
      { error: "rules array is required" },
      { status: 400 },
    );
  }

  const { data: existingRows, error: existingRowsError } = await supabase
    .from("automation_rules")
    .select("id")
    .eq("organization_id", activeOrgId)
    .eq("entity_type", "ticket")
    .returns<ExistingRuleIdRow[]>();

  if (existingRowsError) {
    if (isMissingAutomationRulesTable(existingRowsError)) {
      return NextResponse.json(
        {
          error:
            "Automation schema is missing. Run db/automation-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `Failed to load existing automation rules: ${existingRowsError.message}` },
      { status: 500 },
    );
  }

  const existingIds = new Set((existingRows ?? []).map((row) => row.id));

  for (const entry of inputRules) {
    const name = normalizeName(entry?.name);
    if (!name) {
      return NextResponse.json(
        { error: "Each rule requires a name" },
        { status: 400 },
      );
    }

    if (!isAutomationTriggerEvent(entry?.triggerEvent)) {
      return NextResponse.json(
        { error: `Invalid triggerEvent for rule "${name}"` },
        { status: 400 },
      );
    }

    const normalizedActions = normalizeAutomationActions(entry.actions);
    if (!normalizedActions.length) {
      return NextResponse.json(
        { error: `Rule "${name}" requires at least one valid action` },
        { status: 400 },
      );
    }

    const normalizedConditions = normalizeAutomationConditions(entry.conditions);
    const isEnabled = entry.isEnabled !== false;
    const description = normalizeDescription(entry.description);

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (id && existingIds.has(id)) {
      const { error: updateError } = await supabase
        .from("automation_rules")
        .update({
          name,
          description,
          trigger_event: entry.triggerEvent,
          conditions: normalizedConditions,
          actions: normalizedActions,
          is_enabled: isEnabled,
        })
        .eq("organization_id", activeOrgId)
        .eq("entity_type", "ticket")
        .eq("id", id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to update rule "${name}": ${updateError.message}` },
          { status: 500 },
        );
      }
      continue;
    }

    const { error: insertError } = await supabase
      .from("automation_rules")
      .insert({
        organization_id: activeOrgId,
        entity_type: "ticket",
        name,
        description,
        trigger_event: entry.triggerEvent,
        conditions: normalizedConditions,
        actions: normalizedActions,
        is_enabled: isEnabled,
        created_by: userId,
      });

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to create rule "${name}": ${insertError.message}` },
        { status: 500 },
      );
    }
  }

  const rules = await getAutomationRules(supabase, activeOrgId, userId);
  const payload: AutomationRulesResponse = {
    activeOrgId,
    currentUserId: userId,
    rules,
  };
  return NextResponse.json(payload, { status: 200 });
}
