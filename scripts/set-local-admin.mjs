import fs from 'node:fs';
import path from 'node:path';

const [action, rawEmail] = process.argv.slice(2);
const email = String(rawEmail || '').trim().toLowerCase();

if (!['grant', 'revoke'].includes(action) || !email) {
  console.error('Usage: npm run admin:local -- <grant|revoke> <email>');
  process.exit(1);
}

const databasePath = path.resolve(
  process.env.OTTV2_DB_PATH || path.join(process.cwd(), 'data', 'local-db.json')
);

if (!fs.existsSync(databasePath)) {
  console.error(`Local database not found: ${databasePath}`);
  process.exit(1);
}

const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const user = database.users?.find((entry) => entry.email?.toLowerCase() === email);

if (!user) {
  console.error(`No local account found for ${email}`);
  process.exit(1);
}
if (user.is_system_bot) {
  console.error('The system bot cannot be assigned administrator access.');
  process.exit(1);
}

user.is_admin = action === 'grant';
const temporaryPath = `${databasePath}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
fs.renameSync(temporaryPath, databasePath);

console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} local admin access for ${email}.`);
