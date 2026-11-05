import type { Metadata } from 'next';
import { getWorkspace } from '@/lib/data/load';
import { getSessionUser } from '@/lib/auth';
import { SettingsClient } from './settings-client';

export const metadata: Metadata = { title: 'Nastavení' };

export default async function SettingsPage() {
  const ws = await getWorkspace();
  const user = await getSessionUser();
  return <SettingsClient ws={ws} email={user?.email ?? null} />;
}
