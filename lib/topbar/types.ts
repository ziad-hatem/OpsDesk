export type OrganizationRole = "admin" | "manager" | "support" | "read_only";

export interface TopbarUser {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface TopbarOrganization {
  id: string;
  name: string;
  logo_url: string | null;
  role: OrganizationRole;
}

export interface MeResponse {
  user: TopbarUser;
  organizations: TopbarOrganization[];
  activeOrgId: string | null;
  notifications: {
    unreadCount: number;
  };
  organizationCreation: {
    signupOrganizationName: string | null;
    canCreateFromSignupOrganization: boolean;
  };
}
