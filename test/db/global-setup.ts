// @ts-expect-error – JS modul bez typů
import { resetTestDb } from '../../scripts/test-db-reset.mjs';

export default async function setup() {
  const url: string = await resetTestDb();
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
}
