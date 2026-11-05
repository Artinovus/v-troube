import type { Metadata } from 'next';
import { getWorkspace } from '@/lib/data/load';
import { CafeClient } from './cafe-client';

export const metadata: Metadata = { title: 'Zisk kavárny' };

export default async function CafePage() {
  const ws = await getWorkspace();
  return <CafeClient ws={ws} />;
}
