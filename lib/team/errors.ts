interface SupabaseLikeError {
  message?: string;
}

export function isMissingTeamSchema(error: SupabaseLikeError | null | undefined): boolean {
  const message = (error?.message ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("organization_invites") ||
    message.includes("organization_memberships") ||
    message.includes("organization_membership_status") ||
    message.includes("schema cache")
  );
}

export function missingTeamSchemaMessage(): string {
  return "Team management schema is missing or out of date. Run db/team-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';";
}
