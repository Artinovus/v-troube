import type { Metadata } from 'next';
import { getWorkspace } from '@/lib/data/load';
import { IngredientsClient } from './ingredients-client';

export const metadata: Metadata = { title: 'Suroviny' };

export default async function IngredientsPage() {
  const ws = await getWorkspace();
  return <IngredientsClient ingredients={ws.ingredients} recipes={ws.recipes} />;
}
