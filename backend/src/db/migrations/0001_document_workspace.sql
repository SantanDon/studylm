CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY NOT NULL,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  document_type text DEFAULT 'general',
  template text DEFAULT 'general',
  status text DEFAULT 'draft',
  source_ids text DEFAULT '[]',
  metadata text DEFAULT '{}',
  current_version integer DEFAULT 1,
  created_by text,
  created_at integer DEFAULT (strftime('%s', 'now')),
  updated_at integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS document_versions (
  id text PRIMARY KEY NOT NULL,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  change_summary text,
  source_ids text DEFAULT '[]',
  created_by text,
  created_at integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS documents_notebook_idx ON documents(notebook_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_versions_document_idx ON document_versions(document_id, version DESC);
