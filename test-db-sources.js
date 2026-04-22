import { createClient } from '@libsql/client';
const client = createClient({
  url: 'libsql://studypod-db-santlabsdon.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzQ2MTc3MjQsImlkIjoiMDE5ZDJlZWEtZDAwMS03MzgzLTk2MjMtN2QzMjEzMmIwYTIyIiwicmlkIjoiNzJkOThkMmUtZjI3Yy00MmJjLTliNWEtOTFkNjkwM2Q5NDhjIn0.P8QGjo9qbZA88Wdwx87v0w59CQknAxeo-iM4JrT-OuejoowUQoy2m9cjw5Umbqlx5XBqWkC-vQ-itbpB3ShmAQ'
});
async function run() {
  const res = await client.execute("SELECT id, title, type, processing_status, created_at FROM sources ORDER BY created_at DESC LIMIT 10");
  console.log(JSON.stringify(res.rows, null, 2));
}
run();
