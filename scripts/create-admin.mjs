// Vytvoří administrátorský účet Z trouby, nebo nastaví nové heslo existujícímu.
//
//   npm run create-admin -- email@example.cz
//
// Heslo se zadá interaktivně (nezobrazuje se a nezůstane v historii příkazů),
// případně přes proměnnou ADMIN_PASSWORD. Používá DATABASE_URL.
import postgres from 'postgres';
import readline from 'node:readline';
import { loadEnvFiles } from './migrate.mjs';
import { hashPassword, passwordProblem } from '../src/lib/password.ts';

loadEnvFiles();
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('Chybí DATABASE_URL (v .env.local nebo v prostředí).');
  process.exit(1);
}
const email = (process.argv[2] ?? '').trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Použití: npm run create-admin -- email@example.cz');
  process.exit(1);
}

function askHidden(q) {
  if (process.env.ADMIN_PASSWORD) return Promise.resolve(process.env.ADMIN_PASSWORD);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : '');
  return new Promise((res) => rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); }));
}

const password = await askHidden('Heslo (min. 12 znaků): ');
const problem = passwordProblem(password ?? '');
if (problem) {
  console.error(problem);
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD && (await askHidden('Heslo znovu: ')) !== password) {
  console.error('Hesla se neshodují.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const hash = await hashPassword(password);
  const [row] = await sql`
    insert into public.app_users (email, password_hash, role)
    values (${email}, ${hash}, 'admin')
    on conflict ((lower(email))) do update
      set password_hash = excluded.password_hash, role = 'admin',
          failed_login_attempts = 0, locked_until = null, password_changed_at = now()
    returning (xmax = 0) as created`;
  // nové heslo zneplatní dřívější přihlášení
  if (!row.created) await sql`delete from public.app_sessions s using public.app_users u where s.user_id = u.id and lower(u.email) = lower(${email})`;
  console.log(row.created ? `Účet ${email} vytvořen jako administrátor.` : `Účet ${email} je administrátor, heslo bylo změněno.`);
} catch (e) {
  if (e.code === '42P01') console.error('Tabulky neexistují – nejprve spusťte: npm run db:migrate');
  else console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
