const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://iris:iris_pass@localhost:5432/iris_db' });
client.connect().then(() => {
  client.query("SELECT t.id, t.account_id, t.amount, t.transaction_date, t.type, t.is_deleted, t.metadata_json FROM transactions t WHERE t.metadata_json->>'source' = 'bank_import' LIMIT 10").then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    client.end();
  });
});
