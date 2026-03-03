export function toAuditActionLabel(action: string): string {
  return action
    .replace(/[._:]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function toAuditEntityLabel(entityType: string | null): string {
  if (!entityType) {
    return "-";
  }

  return entityType
    .replace(/[_:]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
