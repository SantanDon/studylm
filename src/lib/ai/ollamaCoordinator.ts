/**
 * Ollama Model Coordinator
 * 
 * Coordinates multiple Ollama models to work together on complex tasks.
 * Models can share context, delegate subtasks, and combine results.
 */

import { chatCompletion, generateEmbeddings, FAST_MODELS } from './ollamaService';

export interface ModelTask {
  id: string;
  type: 'chat' | 'summarize' | 'extract' | 'analyze' | 'embed';
  model: string;
  input: string;
  context?: string;
  dependencies?: string[]; // IDs of tasks that must complete first
  priority?: number; // Higher = more important
}

export interface ModelResult {
  taskId: string;
  model: string;
  output: string;
  metadata?: Record<string, unknown>;
  duration: number;
}

export interface CoordinationSession {
  id: string;
  tasks: ModelTask[];
  results: Map<string, ModelResult>;
  sharedContext: Map<string, unknown>;
}

/**
 * Create a new coordination session
 */
export function createSession(sessionId: string): CoordinationSession {
  return {
    id: sessionId,
    tasks: [],
    results: new Map(),
    sharedContext: new Map(),
  };
}

/**
 * Add a task to the session
 */
export function addTask(session: CoordinationSession, task: ModelTask): void {
  session.tasks.push(task);
  console.log(`📋 Task added: ${task.id} (${task.type}) using ${task.model}`);
}

/**
 * Execute a single task
 */
async function executeTask(
  session: CoordinationSession,
  task: ModelTask
): Promise<ModelResult> {
  const startTime = Date.now();
  console.log(`🚀 Executing task: ${task.id} (${task.type})`);

  // Build context from dependencies
  let fullContext = task.context || '';
  if (task.dependencies && task.dependencies.length > 0) {
    const depResults = task.dependencies
      .map(depId => session.results.get(depId))
      .filter(Boolean)
      .map(result => `[${result!.taskId}]: ${result!.output}`)
      .join('\n\n');
    
    if (depResults) {
      fullContext = `Previous results:\n${depResults}\n\n${fullContext}`;
    }
  }

  let output = '';

  try {
    switch (task.type) {
      case 'chat':
        output = await chatCompletion({
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI assistant working as part of a coordinated system. Use provided context to give accurate answers.',
            },
            {
              role: 'user',
              content: fullContext ? `Context:\n${fullContext}\n\nTask: ${task.input}` : task.input,
            },
          ],
          model: task.model,
          temperature: 0.7,
        });
        break;

      case 'summarize':
        output = await chatCompletion({
          messages: [
            {
              role: 'system',
              content: 'You are a summarization specialist. Create concise, accurate summaries.',
            },
            {
              role: 'user',
              content: `Summarize the following:\n\n${task.input}`,
            },
          ],
          model: task.model,
          temperature: 0.3,
        });
        break;

      case 'extract':
        output = await chatCompletion({
          messages: [
            {
              role: 'system',
              content: 'You are a data extraction specialist. Extract specific information as requested.',
            },
            {
              role: 'user',
              content: fullContext ? `${fullContext}\n\nExtract: ${task.input}` : task.input,
            },
          ],
          model: task.model,
          temperature: 0.2,
        });
        break;

      case 'analyze':
        output = await chatCompletion({
          messages: [
            {
              role: 'system',
              content: 'You are an analysis specialist. Provide detailed, insightful analysis.',
            },
            {
              role: 'user',
              content: fullContext ? `${fullContext}\n\nAnalyze: ${task.input}` : task.input,
            },
          ],
          model: task.model,
          temperature: 0.6,
        });
        break;

      case 'embed': {
        const embeddings = await generateEmbeddings(task.input);
        output = JSON.stringify(embeddings);
        break;
      }

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }

    const duration = Date.now() - startTime;
    const result: ModelResult = {
      taskId: task.id,
      model: task.model,
      output,
      duration,
      metadata: {
        type: task.type,
        hasContext: !!fullContext,
        dependencies: task.dependencies || [],
      },
    };

    console.log(`✅ Task completed: ${task.id} in ${duration}ms`);
    return result;
  } catch (error) {
    console.error(`❌ Task failed: ${task.id}`, error);
    throw error;
  }
}

/**
 * Execute all tasks in the session, respecting dependencies
 */
export async function executeSession(session: CoordinationSession): Promise<Map<string, ModelResult>> {
  console.log(`🎯 Starting coordination session: ${session.id}`);
  console.log(`📊 Total tasks: ${session.tasks.length}`);

  const completed = new Set<string>();
  const pending = new Set(session.tasks.map(t => t.id));

  while (pending.size > 0) {
    // Find tasks that can be executed (all dependencies met)
    const ready = session.tasks.filter(task => {
      if (completed.has(task.id)) return false;
      if (!pending.has(task.id)) return false;
      
      const deps = task.dependencies || [];
      return deps.every(depId => completed.has(depId));
    });

    if (ready.length === 0) {
      console.error('❌ Circular dependency detected or no tasks ready');
      break;
    }

    // Sort by priority (higher first)
    ready.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Execute ready tasks in parallel
    console.log(`⚡ Executing ${ready.length} tasks in parallel...`);
    const results = await Promise.all(
      ready.map(task => executeTask(session, task))
    );

    // Store results
    results.forEach(result => {
      session.results.set(result.taskId, result);
      completed.add(result.taskId);
      pending.delete(result.taskId);
    });
  }

  console.log(`✅ Session completed: ${session.id}`);
  console.log(`📊 Results: ${session.results.size}/${session.tasks.length} tasks`);

  return session.results;
}

/**
 * Coordinate multiple models for a complex query
 */
export async function coordinatedQuery(params: {
  query: string;
  context?: string;
  sources?: Array<{ title: string; content: string }>;
  includeAnalysis?: boolean;
  includeSummary?: boolean;
}): Promise<{
  answer: string;
  summary?: string;
  analysis?: string;
  metadata: Record<string, unknown>;
}> {
  const sessionId = `session-${Date.now()}`;
  const session = createSession(sessionId);

  console.log('🤝 Starting coordinated query with multiple models...');

  // Task 1: Extract key information from sources
  if (params.sources && params.sources.length > 0) {
    const sourceContent = params.sources
      .map(s => `${s.title}:\n${s.content}`)
      .join('\n\n');

    addTask(session, {
      id: 'extract-key-info',
      type: 'extract',
      model: FAST_MODELS.summarize,
      input: `Extract key facts and information relevant to: "${params.query}"`,
      context: sourceContent,
      priority: 10,
    });
  }

  // Task 2: Generate main answer (depends on extraction if sources exist)
  addTask(session, {
    id: 'main-answer',
    type: 'chat',
    model: FAST_MODELS.chat,
    input: params.query,
    context: params.context,
    dependencies: params.sources ? ['extract-key-info'] : undefined,
    priority: 9,
  });

  // Task 3: Generate summary (optional, depends on main answer)
  if (params.includeSummary) {
    addTask(session, {
      id: 'summary',
      type: 'summarize',
      model: FAST_MODELS.summarize,
      input: 'Summarize the main answer in 2-3 sentences',
      dependencies: ['main-answer'],
      priority: 5,
    });
  }

  // Task 4: Generate analysis (optional, depends on main answer)
  if (params.includeAnalysis) {
    addTask(session, {
      id: 'analysis',
      type: 'analyze',
      model: FAST_MODELS.chat,
      input: 'Provide deeper analysis and implications',
      dependencies: ['main-answer'],
      priority: 5,
    });
  }

  // Execute all tasks
  const results = await executeSession(session);

  // Compile results
  const answer = results.get('main-answer')?.output || 'No answer generated';
  const summary = results.get('summary')?.output;
  const analysis = results.get('analysis')?.output;

  const metadata = {
    sessionId,
    tasksExecuted: results.size,
    totalDuration: Array.from(results.values()).reduce((sum, r) => sum + r.duration, 0),
    models: Array.from(new Set(Array.from(results.values()).map(r => r.model))),
  };

  console.log('✅ Coordinated query completed:', metadata);

  return {
    answer,
    summary,
    analysis,
    metadata,
  };
}

export default {
  createSession,
  addTask,
  executeSession,
  coordinatedQuery,
};

