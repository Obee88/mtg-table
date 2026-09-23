import { z } from 'zod';

export const emailSchema = z.email().trim().toLowerCase().max(254);
export const passwordSchema = z.string().min(6).max(200);
export const displayNameSchema = z.string().trim().min(2).max(32);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  inviteCode: z.string().trim().min(1).max(64).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface Invite {
  code: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

/** A member of the group, as shown in pickers. */
export interface UserSummary {
  id: string;
  displayName: string;
}

/** The caller's friends, requests waiting for their answer, and requests they sent. */
export interface FriendsResponse {
  friends: UserSummary[];
  incoming: UserSummary[];
  outgoing: UserSummary[];
}

export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** A reset the admin can act on: who asked (or was picked), and the one-time link once issued. */
export interface PasswordReset {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  requestedAt: string;
  /** Present until the link is used or expires; only ever returned to the admin who issues it. */
  link: string | null;
  expiresAt: string | null;
  usedAt: string | null;
}

export const changePasswordSchema = z.object({ current: z.string().min(1).max(200), next: passwordSchema });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** An account as the admin sees it. */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}
