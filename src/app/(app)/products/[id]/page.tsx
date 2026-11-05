import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getWorkspace } from '@/lib/data/load';
import { ProductDetail } from './product-detail';

export const metadata: Metadata = { title: 'Výrobek' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const product = id === 'new' ? null : ws.products.find((p) => p.id === id);
  if (id !== 'new' && !product) notFound();
  return <ProductDetail key={id} product={product ?? null} ws={ws} />;
}
