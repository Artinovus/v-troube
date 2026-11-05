import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getWorkspace } from '@/lib/data/load';
import { RecipeEditor } from './recipe-editor';

export const metadata: Metadata = { title: 'Receptura' };

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const recipe = id === 'new' ? null : ws.recipes.find((r) => r.id === id);
  if (id !== 'new' && !recipe) notFound();
  return <RecipeEditor key={id} initial={recipe ?? null} recipes={ws.recipes} ingredients={ws.ingredients} products={ws.products} />;
}
