import { redirectIfSignedIn } from '@/lib/server/signed-in-redirect';

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  await redirectIfSignedIn();
  return children;
}
