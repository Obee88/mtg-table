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
