import { LocalNotebook, LocalSource } from '@/services/localStorageService';
import { Note } from '@/hooks/useNotes';
import { FlashcardDeck } from '@/types/flashcard';

export interface ExportOptions {
  includeSources: boolean;
  includeNotes: boolean;
  includeFlashcards: boolean;
  includeChat: boolean;
  obsidianFormat: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ExportData {
  notebook: LocalNotebook;
  sources?: LocalSource[];
  notes?: Note[];
  flashcardDecks?: FlashcardDeck[];
  chatHistory?: ChatMessage[];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function generateTableOfContents(options: ExportOptions, data: ExportData): string {
  const sections: string[] = [];

  if (options.includeSources && data.sources?.length) {
    sections.push('- [Sources](#sources)');
  }
  if (options.includeNotes && data.notes?.length) {
    sections.push('- [Notes](#notes)');
  }
  if (options.includeFlashcards && data.flashcardDecks?.length) {
    sections.push('- [Flashcards](#flashcards)');
  }
  if (options.includeChat && data.chatHistory?.length) {
    sections.push('- [Chat History](#chat-history)');
  }

  if (sections.length === 0) return '';

  return `## Table of Contents\n\n${sections.join('\n')}\n`;
}

function generateYamlFrontmatter(data: ExportData, _options: ExportOptions): string {
  const tags: string[] = ['studylm', 'notebook'];
  
  if (data.sources?.length) {
    const sourceTypes = [...new Set(data.sources.map(s => s.type))];
    tags.push(...sourceTypes.map(t => `source-${t}`));
  }

  const frontmatter = [
    '---',
    `title: "${data.notebook.title.replace(/"/g, '\\"')}"`,
    `created: ${data.notebook.created_at}`,
    `updated: ${data.notebook.updated_at}`,
    `tags: [${tags.join(', ')}]`,
  ];

  if (data.notebook.description) {
    frontmatter.push(`description: "${data.notebook.description.replace(/"/g, '\\"')}"`);
  }

  frontmatter.push('---');
  return frontmatter.join('\n');
}

function formatLink(title: string, url: string | undefined, obsidianFormat: boolean): string {
  if (!url) return title;
  
  if (obsidianFormat) {
    return `[[${title}]]`;
  }
  return `[${title}](${url})`;
}

function generateSourcesSection(sources: LocalSource[], obsidianFormat: boolean): string {
  if (!sources.length) return '';

  const lines = ['## Sources\n'];

  sources.forEach((source, index) => {
    const sourceNum = index + 1;
    const title = source.title || 'Untitled Source';
    const typeEmojiMap: Record<LocalSource['type'], string> = {
      pdf: '📄',
      text: '📝',
      website: '🌐',
      youtube: '🎬',
      audio: '🎵',
      image: '🖼️',
      ebook: '📚',
      tweet: '💬',
      'multiple-websites': '🌐',
      video: '🎥',
      'copied-text': '📝',
      doc: '📄',
    };
    const typeEmoji = typeEmojiMap[source.type];

    lines.push(`### ${sourceNum}. ${typeEmoji} ${title}\n`);
    
    if (obsidianFormat) {
      lines.push(`#source-${source.type}`);
    }

    lines.push(`- **Type:** ${source.type}`);
    lines.push(`- **Added:** ${formatDate(source.created_at)}`);
    
    if (source.url) {
      lines.push(`- **URL:** ${formatLink(source.url, source.url, false)}`);
    }

    if (source.summary) {
      lines.push(`\n**Summary:**\n${source.summary}`);
    }

    if (source.content) {
      const truncatedContent = source.content.length > 500 
        ? source.content.substring(0, 500) + '...' 
        : source.content;
      lines.push(`\n<details>\n<summary>Content Preview</summary>\n\n${truncatedContent}\n\n</details>`);
    }

    lines.push('');
  });

  return lines.join('\n');
}

function generateNotesSection(notes: Note[], obsidianFormat: boolean): string {
  if (!notes.length) return '';

  const lines = ['## Notes\n'];

  notes.forEach((note, index) => {
    const noteNum = index + 1;
    const title = note.title || 'Untitled Note';
    const sourceIcon = note.source_type === 'ai_response' ? '🤖' : '✍️';

    lines.push(`### ${noteNum}. ${sourceIcon} ${title}\n`);

    if (obsidianFormat) {
      lines.push(`#note #${note.source_type.replace('_', '-')}`);
    }

    lines.push(`*Created: ${formatDate(note.created_at)}*\n`);
    lines.push(note.content);
    lines.push('');
  });

  return lines.join('\n');
}

function generateFlashcardsSection(decks: FlashcardDeck[], obsidianFormat: boolean): string {
  if (!decks.length) return '';

  const lines = ['## Flashcards\n'];

  decks.forEach((deck) => {
    lines.push(`### 📚 ${deck.name}\n`);
    
    if (obsidianFormat) {
      lines.push('#flashcards');
    }

    lines.push(`*${deck.cards.length} cards | Created: ${formatDate(deck.createdAt)}*\n`);

    deck.cards.forEach((card, cardIndex) => {
      lines.push(`#### Card ${cardIndex + 1}`);
      lines.push(`**Q:** ${card.front}`);
      lines.push(`**A:** ${card.back}`);
      lines.push(`*Difficulty: ${card.difficulty} | Type: ${card.cardType}*`);
      lines.push('');
    });
  });

  return lines.join('\n');
}

function generateChatSection(chatHistory: ChatMessage[]): string {
  if (!chatHistory.length) return '';

  const lines = ['## Chat History\n'];

  chatHistory.forEach((message, _index) => {
    const roleEmoji = message.role === 'user' ? '👤' : '🤖';
    const roleName = message.role === 'user' ? 'You' : 'Assistant';
    
    lines.push(`### ${roleEmoji} ${roleName}\n`);
    lines.push(message.content);
    lines.push('');
  });

  return lines.join('\n');
}

export function exportToMarkdown(data: ExportData, options: ExportOptions): string {
  const sections: string[] = [];

  sections.push(generateYamlFrontmatter(data, options));
  sections.push(`# ${data.notebook.title}\n`);

  if (data.notebook.description) {
    sections.push(`> ${data.notebook.description}\n`);
  }

  sections.push(generateTableOfContents(options, data));

  if (options.includeSources && data.sources?.length) {
    sections.push(generateSourcesSection(data.sources, options.obsidianFormat));
  }

  if (options.includeNotes && data.notes?.length) {
    sections.push(generateNotesSection(data.notes, options.obsidianFormat));
  }

  if (options.includeFlashcards && data.flashcardDecks?.length) {
    sections.push(generateFlashcardsSection(data.flashcardDecks, options.obsidianFormat));
  }

  if (options.includeChat && data.chatHistory?.length) {
    sections.push(generateChatSection(data.chatHistory));
  }

  sections.push('---\n*Exported from StudyPodLM*');

  return sections.filter(Boolean).join('\n');
}

export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateFilename(title: string, obsidianFormat: boolean): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  
  const timestamp = new Date().toISOString().split('T')[0];
  const suffix = obsidianFormat ? '-obsidian' : '';
  
  return `${sanitized}${suffix}-${timestamp}.md`;
}
