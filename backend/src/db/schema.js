import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    email: text('email').unique().notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    accountType: text('account_type', { enum: ['human', 'agent'] }).default('human'),
    webhookUrl: text('webhook_url'),
    ownerId: text('owner_id'),
    isVerified: integer('is_verified', { mode: 'boolean' }).default(false),
    verificationToken: text('verification_token'),
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
    emailConsent: integer('email_consent', { mode: 'boolean' }).default(false),
    emailConsentAt: integer('email_consent_at', { mode: 'timestamp' }),
    recoveryHash: text('recovery_hash'),
    twoFactorSecret: text('two_factor_secret'),
    twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false),
    youtubeExtractionsToday: integer('youtube_extractions_today').default(0),
    lastExtractionReset: integer('last_extraction_reset', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const recoveryTokens = sqliteTable('recovery_tokens', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    used: integer('used', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const notebooks = sqliteTable('notebooks', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    exampleQuestions: text('example_questions'),
    generationStatus: text('generation_status').default('pending'),
    icon: text('icon'),
    joinCode: text('join_code').unique(),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const notebookMembers = sqliteTable('notebook_members', {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').default('viewer'),
    joinedAt: integer('joined_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const sources = sqliteTable('sources', {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type').notNull(),
    content: text('content'),
    url: text('url'),
    metadata: text('metadata'),
    filePath: text('file_path'),
    fileSize: integer('file_size'),
    processingStatus: text('processing_status').default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const notes = sqliteTable('notes', {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    version: integer('version').default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const documents = sqliteTable('documents', {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    documentType: text('document_type').default('general'),
    template: text('template').default('general'),
    status: text('status', { enum: ['draft', 'review', 'final'] }).default('draft'),
    sourceIds: text('source_ids').default('[]'),
    metadata: text('metadata').default('{}'),
    currentVersion: integer('current_version').default(1),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const documentVersions = sqliteTable('document_versions', {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    changeSummary: text('change_summary'),
    sourceIds: text('source_ids').default('[]'),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const memories = sqliteTable('memories', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: text('embedding').notNull(),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
export const chatMessages = sqliteTable('chat_messages', {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    groundedSources: text('grounded_sources'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const sync_data = sqliteTable('sync_data', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  encryptedData: text('encrypted_data').notNull(),
  checksum: text('checksum').notNull(),
  version: integer('version').default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// RAIPH LOOP INJECTIONS: TAGS AND TASKS
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  notebookId: text('notebook_id').references(() => notebooks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').default('#6366f1'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  assignee: text('assignee').default('human'),
  result: text('result'),
  status: text('status', { enum: ['pending', 'completed'] }).default('pending'),
  priority: text('priority', { enum: ['low', 'medium', 'high'] }).default('medium'),
  dueDate: integer('due_date', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(), // 'human' or agent display name / id
  actionType: text('action_type').notNull(),
  contentPreview: text('content_preview'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const scratchpad = sqliteTable('scratchpad', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  ttlExpiresAt: integer('ttl_expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  eventsJson: text('events_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const agentMissions = sqliteTable('agent_missions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  goal: text('goal').notNull(),
  cron: text('cron'),
  maxNotes: integer('max_notes').default(5),
  status: text('status', { enum: ['active', 'paused', 'completed', 'failed'] }).default('active'),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
  result: text('result'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  fromAgentId: text('from_agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toAgentId: text('to_agent_id').references(() => users.id, { onDelete: 'set null' }),
  messageType: text('message_type').default('thought'),
  subject: text('subject'),
  content: text('content').notNull(),
  read: integer('read', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  label: text('label').default('My Agent Key'),
  scopes: text('scopes').default('["notebooks:read","notes:create","chat:all"]'),
  notebookIds: text('notebook_ids'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  rateLimit: integer('rate_limit').default(0),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const pairingCodes = sqliteTable('pairing_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const deletedNotebooks = sqliteTable('deleted_notebooks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const signalQueue = sqliteTable('signal_queue', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  notebookId: text('notebook_id').references(() => notebooks.id, { onDelete: 'cascade' }),
  sourceId: text('source_id'),
  tweetSourceId: text('tweet_source_id'),
  platform: text('platform').notNull(),
  content: text('content').notNull(),
  status: text('status').default('draft'),
  scheduledFor: integer('scheduled_for', { mode: 'timestamp' }),
  postedAt: integer('posted_at', { mode: 'timestamp' }),
  noteId: text('note_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const researchGoals = sqliteTable('research_goals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  parentGoalId: text('parent_goal_id'),
  status: text('status', { enum: ['active', 'completed', 'paused', 'archived'] }).default('active'),
  priority: text('priority', { enum: ['low', 'medium', 'high'] }).default('medium'),
  sourceId: text('source_id'),
  sourceChunkId: text('source_chunk_id'),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp' }),
  progressPct: integer('progress_pct').default(0),
  linkedTaskIds: text('linked_task_ids').default('[]'),
  linkedArtifactIds: text('linked_artifact_ids').default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const signalQueueSuggestions = sqliteTable('signal_queue_suggestions', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  rationale: text('rationale'),
  sourceChunkIndices: text('source_chunk_indices').default('[]'),
  confidence: real('confidence').default(0.5),
  status: text('status', { enum: ['pending', 'accepted', 'dismissed'] }).default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
