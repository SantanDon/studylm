export type DocumentStatus = 'draft' | 'review' | 'final';
export type DocumentType = 'general' | 'cv' | 'assignment' | 'report' | 'cover-letter' | 'study-guide' | 'memo';
export type DocumentExportFormat = 'docx' | 'pdf' | 'md' | 'txt';

export interface DocumentArtifact {
  id: string;
  notebookId: string;
  userId?: string;
  title: string;
  content: string;
  documentType: DocumentType | string;
  template: string;
  status: DocumentStatus;
  sourceIds: string[];
  metadata: Record<string, unknown>;
  currentVersion: number;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  userId?: string;
  version: number;
  title: string;
  content: string;
  changeSummary?: string | null;
  sourceIds: string[];
  createdBy?: string | null;
  createdAt: string;
}

export interface DocumentRevisionCitation {
  sourceId: string;
  reason: string;
}

export interface DocumentRevisionProposal {
  revisedText: string;
  revisedContent: string;
  originalText: string;
  selection: { start: number; end: number; text: string } | null;
  explanation: string;
  changeSummary: string;
  citations: DocumentRevisionCitation[];
  modelUsed?: string;
  tokensUsed?: number;
}

export interface CreateDocumentInput {
  title: string;
  content?: string;
  documentType?: DocumentType | string;
  template?: string;
  status?: DocumentStatus;
  sourceIds?: string[];
  metadata?: Record<string, unknown>;
  changeSummary?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: string;
  documentType?: DocumentType | string;
  template?: string;
  status?: DocumentStatus;
  sourceIds?: string[];
  metadata?: Record<string, unknown>;
  expectedVersion?: number;
  changeSummary?: string;
}

export interface DocumentRevisionInput {
  instruction: string;
  selection?: { start: number; end: number } | null;
  sourceIds?: string[];
}

export interface DocumentTemplate {
  id: string;
  label: string;
  description: string;
  documentType: DocumentType;
  title: string;
  content: string;
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'blank',
    label: 'Blank document',
    description: 'Start with a clean page.',
    documentType: 'general',
    title: 'Untitled Document',
    content: '',
  },
  {
    id: 'cv',
    label: 'Professional CV',
    description: 'A clean, evidence-aware CV structure.',
    documentType: 'cv',
    title: 'Professional CV',
    content: '# Full Name\n\nContact details\n\n## Professional Summary\n\nWrite a concise summary grounded in your actual experience.\n\n## Experience\n\n### Role — Organisation\nDates\n\n- Achievement or responsibility\n\n## Education\n\n### Qualification — Institution\nDates\n\n## Projects\n\n### Project name\n- What you built, how you built it, and the outcome\n\n## Skills\n\n- Skill\n',
  },
  {
    id: 'assignment',
    label: 'Academic assignment',
    description: 'Structured introduction, analysis, conclusion and references.',
    documentType: 'assignment',
    title: 'Academic Assignment',
    content: '# Assignment Title\n\n## Introduction\n\nState the question, scope and central argument.\n\n## Main Analysis\n\nDevelop the argument using the notebook sources.\n\n## Conclusion\n\nSummarise the answer without introducing new claims.\n\n## References\n\n- Add references in the required citation style.\n',
  },
  {
    id: 'report',
    label: 'Research report',
    description: 'Executive summary, findings and recommendations.',
    documentType: 'report',
    title: 'Research Report',
    content: '# Research Report\n\n## Executive Summary\n\n## Background\n\n## Method and Sources\n\n## Findings\n\n## Analysis\n\n## Recommendations\n\n## References\n',
  },
  {
    id: 'cover-letter',
    label: 'Cover letter',
    description: 'A focused professional application letter.',
    documentType: 'cover-letter',
    title: 'Cover Letter',
    content: 'Full Name\nContact details\nDate\n\nHiring Manager\nOrganisation\n\nDear Hiring Manager,\n\nWrite a focused opening explaining the role and your genuine interest.\n\nConnect your actual experience and projects to the role requirements.\n\nClose with a clear, professional call to action.\n\nKind regards,\nFull Name\n',
  },
  {
    id: 'study-guide',
    label: 'Study guide',
    description: 'Key concepts, examples, questions and revision checklist.',
    documentType: 'study-guide',
    title: 'Study Guide',
    content: '# Study Guide\n\n## Learning Outcomes\n\n## Key Concepts\n\n## Worked Examples\n\n## Common Mistakes\n\n## Practice Questions\n\n## Revision Checklist\n',
  },
];
