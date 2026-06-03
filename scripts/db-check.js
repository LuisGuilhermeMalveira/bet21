// Sanidade do banco: abre, migra e mostra as tabelas e suas colunas.
// Uso: npm run db:check
import { openDb } from '../src/db/index.js';
import { SCHEMA } from '../src/db/schema.js';
import { existingColumns } from '../src/db/migrate.js';

const db = openDb();
console.log('Banco aberto e migrado com sucesso.\n');
for (const t of SCHEMA) {
  const cols = [...existingColumns(db, t.name)];
  console.log(`• ${t.name} (${cols.length} colunas)`);
}
db.close();
process.exitCode = 0;
