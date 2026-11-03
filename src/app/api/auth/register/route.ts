import { managedAccountsOnly } from '@/lib/server/account-access';

export const runtime = 'nodejs';
export function POST() {
  return managedAccountsOnly();
}
