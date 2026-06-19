export type Domain = "notes" | "files" | "chat" | "calendar" | "projects";

export interface CurrentUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string;
  accentColor: string;
  fontFamily: string;
  isActive: boolean;
  isSystemAdmin: boolean;
  emailVerified: boolean;
}
