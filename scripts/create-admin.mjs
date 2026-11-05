// Vytvoří (nebo povýší) administrátorský účet Z trouby.
// Spouštějte JEN na svém počítači – potřebuje SUPABASE_SERVICE_ROLE_KEY,
// který nikdy nesmí být v klientském kódu ani na Vercelu.
//
//   npm run create-admin -- email@example.cz
//
// Heslo se zadá interaktivně (nezobrazuje se v historii příkazů),
// nebo přes proměnnou ADMIN_PASSWORD.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY (v .env.local).');
  process.exit(1);
}

const email = process.argv[2];
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Použití: npm run create-admin -- email@example.cz');
  process.exit(1);
}

async function askHidden(q) {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : '');
  return new Promise((res) => rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); }));
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let userId;
const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) throw listErr;
const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (existing) {
  userId = existing.id;
  console.log('Uživatel už existuje – bude povýšen na administrátora.');
} else {
  const password = await askHidden('Heslo (min. 12 znaků): ');
  if (!password || password.length < 12) {
    console.error('Heslo musí mít alespoň 12 znaků.');
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log('Účet vytvořen.');
}

const { error: upErr } = await supabase.from('profiles').upsert({ id: userId, email, role: 'admin' });
if (upErr) throw upErr;
console.log(`Hotovo: ${email} je administrátor. Přihlaste se v aplikaci.`);
