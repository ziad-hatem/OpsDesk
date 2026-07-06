import { NextResponse } from "next/server";
import { resetDemoAccount } from "@/lib/server/demo-reset";

export const runtime = "nodejs";

// Mirrors the shared-secret check used by /api/reports/schedules/run: Vercel Cron
// automatically sends `Authorization: Bearer $CRON_SECRET` when that env var is set
// (see vercel.json), and any other external scheduler can send either header manually.
function readSchedulerSecret(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const fallback = req.headers.get("x-scheduler-secret");
  return fallback?.trim() || null;
}

async function handleReset(req: Request) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const providedSecret = readSchedulerSecret(req);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized scheduler request" }, { status: 401 });
  }

  try {
    const summary = await resetDemoAccount();
    return NextResponse.json({ ok: true, ...summary }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reset demo account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel Cron Jobs always invoke via GET.
export async function GET(req: Request) {
  return handleReset(req);
}

// Kept for manual triggers / non-Vercel external schedulers.
export async function POST(req: Request) {
  return handleReset(req);
}
