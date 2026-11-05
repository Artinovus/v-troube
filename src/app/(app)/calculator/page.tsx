import type { Metadata } from 'next';
import { getWorkspace } from '@/lib/data/load';
import { CalculatorClient } from './calculator-client';

export const metadata: Metadata = { title: 'Kalkulačka' };

export default async function CalculatorPage() {
  const ws = await getWorkspace();
  return <CalculatorClient ws={ws} />;
}
