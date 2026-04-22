import { createClient } from '@libsql/client';
const client = createClient({
  url: 'libsql://studypod-db-santlabsdon.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzQ2MTc3MjQsImlkIjoiMDE5ZDJlZWEtZDAwMS03MzgzLTk2MjMtN2QzMjEzMmIwYTIyIiwicmlkIjoiNzJkOThkMmUtZjI3Yy00MmJjLTliNWEtOTFkNjkwM2Q5NDhjIn0.P8QGjo9qbZA88Wdwx87v0w59CQknAxeo-iM4JrT-OuejoowUQoy2m9cjw5Umbqlx5XBqWkC-vQ-itbpB3ShmAQ'
});
async function run() {
  const ids = ['58aba1fa-5a25-4a52-99ad-3b4ade906476', '4b285557-5e34-4b3c-8061-d267e77d9d83'];
  for (const id of ids) {
    const res = await client.execute({
      sql: "SELECT title, content FROM sources WHERE id = ?",
      args: [id]
    });
    const row = res.rows[0];
    if (row) {
      console.log(`\n\n--- SOURCE: ${row.title} ---\n`);
      console.log(row.content.substring(0, 1500) + '...');
    }
  }
}
run();
