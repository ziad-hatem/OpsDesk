export type SavedViewEntityType = "tickets" | "orders" | "customers";
export type SavedViewScope = "personal" | "team";

export interface SavedView {
  id: string;
  organization_id: string;
  user_id: string;
  entity_type: SavedViewEntityType;
  scope: SavedViewScope;
  name: string;
  filters: Record<string, unknown>;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface SavedViewsResponse {
  activeOrgId: string;
  currentUserId: string;
  entityType: SavedViewEntityType;
  views: SavedView[];
}
