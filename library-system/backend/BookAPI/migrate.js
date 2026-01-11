const fs = require('fs');
const { Client } = require('pg');

const sql = fs.readFileSync('./migrations/init.sql', 'utf8');
const connectionString = process.env.DATABASE_URL || 'postgres://library:library@postgres:5432/librarydb';

async function apply() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const client = new Client({ connectionString });
      await client.connect();
      const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
      for (const s of stmts) {
        await client.query(s);
      }
      await client.end();
      console.log('BookAPI: migrations applied');
      return;
    } catch (err) {
      console.log(`BookAPI: migration attempt ${attempt} failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('BookAPI: migrations failed after retries');
}

apply().catch(err => { console.error(err); process.exit(1); });
