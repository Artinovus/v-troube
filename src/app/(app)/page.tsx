import { getWorkspace } from '@/lib/data/load';
import { Dashboard } from './dashboard';

export default async function HomePage() {
  const ws = await getWorkspace();
  return <Dashboard ws={ws} />;
}
