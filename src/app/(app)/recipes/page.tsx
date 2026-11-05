import type { Metadata } from 'next';
import { getWorkspace } from '@/lib/data/load';
import { RecipesClient } from './recipes-client';

export const metadata: Metadata = { title: 'Receptury' };

export default async function RecipesPage() {
  const ws = await getWorkspace();
  return <RecipesClient recipes={ws.recipes} ingredients={ws.ingredients} products={ws.products} />;
}
