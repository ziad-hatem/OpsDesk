interface SupabaseLikeError {
  message?: string;
}

export function isMissingTableInSchemaCache(
  error: SupabaseLikeError | null | undefined,
  tableName: string,
): boolean {
  const message = error?.message ?? "";
  if (!message) {
    return false;
  }

  return (
    message.includes(`public.${tableName}`) &&
    message.toLowerCase().includes("schema cache")
  );
}

export function missingTableMessage(tableName: string): string {
  return `Database table public.${tableName} is missing. Run db/tickets-schema.sql in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';`;
}

export function missingTableMessageWithMigration(
  tableName: string,
  migrationFile: string,
): string {
  return `Database table public.${tableName} is missing. Run ${migrationFile} in Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';`;
}
