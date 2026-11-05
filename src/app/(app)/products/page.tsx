import type { Metadata } from 'next';
import { getWorkspace } from '@/lib/data/load';
import { ProductsClient } from './products-client';

export const metadata: Metadata = { title: 'Výrobky a ceny' };

export default async function ProductsPage() {
  const ws = await getWorkspace();
  return <ProductsClient ws={ws} />;
}
