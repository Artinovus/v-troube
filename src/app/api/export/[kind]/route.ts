import { NextResponse } from 'next/server';
import { withAdminTx, AuthError } from '@/lib/auth';
import { loadWorkspace } from '@/lib/data/repo';
import { exportBackup } from '@/lib/data/transfer';
import { buildCalculationCsv, buildIngredientsCsv, buildProductsCsv } from '@/lib/backup/exports';

export const dynamic = 'force-dynamic';

const today = () => new Date().toISOString().slice(0, 10);

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  try {
    if (kind === 'backup') {
      const backup = await withAdminTx((tx) => exportBackup(tx));
      return new NextResponse(JSON.stringify(backup, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="z-trouby-zaloha-${today()}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const ws = await withAdminTx((tx) => loadWorkspace(tx));
    let csv: string;
    switch (kind) {
      case 'ingredients':
        csv = buildIngredientsCsv(ws);
        break;
      case 'products':
        csv = buildProductsCsv(ws);
        break;
      case 'calculation':
        csv = buildCalculationCsv(ws);
        break;
      default:
        return NextResponse.json({ error: 'Neznámý export.' }, { status: 404 });
    }
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="z-trouby-${kind}-${today()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.code === 'unauthenticated' ? 401 : 403 });
    console.error(e);
    return NextResponse.json({ error: 'Export se nezdařil.' }, { status: 500 });
  }
}
