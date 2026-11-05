import { requireAdminPage } from '@/lib/auth';
import { AppShell } from '@/components/app/shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage();
  return <AppShell email={user.email}>{children}</AppShell>;
}
