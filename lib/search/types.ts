export type GlobalSearchItemType = "ticket" | "customer" | "order" | "team_member";

export interface GlobalSearchItem {
  id: string;
  type: GlobalSearchItemType;
  title: string;
  subtitle: string;
  href: string;
  createdAt: string;
}

export interface GlobalSearchResponse {
  query: string;
  items: GlobalSearchItem[];
}
