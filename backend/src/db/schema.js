import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
    apiKeys: text('api_keys'), // BYOK dynamic key store
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
    joinedAt: integer('joined_at'),
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
  status: text('status', { enum: ['pending', 'completed'] }).default('pending'),
  priority: text('priority', { enum: ['low', 'medium', 'high'] }).default('medium'),
  dueDate: integer('due_date', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
