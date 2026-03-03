import { NextResponse } from "next/server";
import { authorizeRbacAction, decideApprovalRequest } from "@/lib/server/rbac";
import { getOrganizationActorContext } from "@/lib/server/organization-context";

type RouteContext = {
  params: Promise<{ orgId: string; requestId: string }>;
};

type DecisionBody = {
  decision?: string;
  comment?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveParams(context: RouteContext): Promise<{ orgId: string; requestId: string }> {
  const params = await context.params;
  return {
    orgId: params.orgId?.trim() ?? "",
    requestId: params.requestId?.trim() ?? "",
  };
}

export async function POST(req: Request, context: RouteContext) {
  const { orgId, requestId } = await resolveParams(context);
  if (!requestId) {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }

  const actorContextResult = await getOrganizationActorContext(orgId);
  if (!actorContextResult.ok) {
    return NextResponse.json(
      { error: actorContextResult.error },
      { status: actorContextResult.status },
    );
  }

  const {
    supabase,
    userId,
    actorMembership,
  } = actorContextResult.context;

  const canReviewResult = await authorizeRbacAction({
    supabase,
    organizationId: orgId,
    userId,
    permissionKey: "action.approvals.review",
    actionLabel: "Review approval request",
    fallbackAllowed: actorMembership.role === "admin" || actorMembership.role === "manager",
    useApprovalFlow: false,
    actorMembership: {
      id: actorMembership.id,
      userId,
      role: actorMembership.role,
      status: actorMembership.status,
      customRoleId: actorMembership.custom_role_id ?? null,
    },
  });

  if (!canReviewResult.ok) {
    return NextResponse.json(
      { error: canReviewResult.error },
      { status: canReviewResult.status },
    );
  }

  let body: DecisionBody = {};
  try {
    body = (await req.json()) as DecisionBody;
  } catch {
    body = {};
  }

  const decision = normalizeText(body.decision)?.toLowerCase();
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be approved or rejected" },
      { status: 400 },
    );
  }

  const result = await decideApprovalRequest({
    supabase,
    organizationId: orgId,
    requestId,
    actorMembership: canReviewResult.membership,
    decision,
    comment: body.comment,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      requestId: result.requestId,
      status: result.status,
    },
    { status: 200 },
  );
}
