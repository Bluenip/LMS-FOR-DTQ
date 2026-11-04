import { z } from 'zod';
import { readJsonObject } from './request';

/**
 * Accounts are issued by administrators. Public sign-up, email verification and
 * password-reset links were removed; their endpoints answer 403 through
 * `managedAccountsOnly`. Only the shared input rules remain here.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
  .max(128, 'Mật khẩu tối đa 128 ký tự.');
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(200)
  .transform((value) => value.toLowerCase());
export const accountInput = readJsonObject;
