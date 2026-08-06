import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SourceComparisonView from '@/components/notebook/SourceComparisonView';
import { useSourceComparison } from '@/components/notebook/hooks/useSourceComparison';

vi.mock('@/components/notebook/hooks/useSourceComparison', () => ({
  useSourceComparison: vi.fn(),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div aria-hidden="true" />,
}));

const sources = [
  {
    id: 'source-1',
    notebook_id: 'notebook-1',
    title: 'Policy source',
    type: 'text',
    content: 'Weekly review requires citations and evidence checks.',
    summary: 'A weekly review policy.',
    processing_status: 'completed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'source-2',
    notebook_id: 'notebook-1',
    title: 'Practice source',
    type: 'text',
    content: 'Daily review requires evidence checks before action.',
    summary: 'A daily practice guide.',
    processing_status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockedUseSourceComparison = vi.mocked(useSourceComparison);

const baseHookState = {
  selectedSource1: '',
  setSelectedSource1: vi.fn(),
  selectedSource2: '',
  setSelectedSource2: vi.fn(),
  isAnalyzing: false,
  comparisonResult: null,
  error: null,
  source1: undefined,
  source2: undefined,
  sharedKeywords: [],
  handleCompare: vi.fn(),
  canCompare: false,
};

describe('SourceComparisonView', () => {
  it('exposes clear evidence controls and keeps comparison disabled until two sources are selected', () => {
    mockedUseSourceComparison.mockReturnValue(baseHookState);

    render(<SourceComparisonView sources={sources} notebookId="notebook-1" onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Compare Sources' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'First source' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Second source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare evidence' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close comparison' })).toBeInTheDocument();
    expect(screen.getAllByText(/Choose a ready source above/i)).toHaveLength(2);
    expect(screen.getByTestId('compact-source-comparison-layout')).toBeInTheDocument();
  });

  it('keeps source text visible beside a structured comparison result', () => {
    mockedUseSourceComparison.mockReturnValue({
      ...baseHookState,
      selectedSource1: 'source-1',
      selectedSource2: 'source-2',
      source1: sources[0],
      source2: sources[1],
      canCompare: true,
      sharedKeywords: ['review', 'evidence'],
      comparisonResult: {
        commonThemes: ['Both require evidence checks.'],
        uniquePointsSource1: ['The policy uses a weekly cadence.'],
        uniquePointsSource2: ['The guide uses a daily cadence.'],
        contradictions: ['The review cadence differs.'],
        sharedKeywords: ['review', 'evidence'],
      },
    });

    render(<SourceComparisonView sources={sources} notebookId="notebook-1" onClose={vi.fn()} />);

    expect(screen.getAllByText('Policy source').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('source-1-evidence-pane')[0]).toHaveTextContent(
      'Weekly review requires citations and evidence checks.',
    );
    expect(screen.getAllByTestId('source-2-evidence-pane')[0]).toHaveTextContent(
      'Daily review requires evidence checks before action.',
    );
    expect(screen.getByRole('heading', { name: 'Comparison analysis' })).toBeInTheDocument();
    expect(screen.getByText('Agreements')).toBeInTheDocument();
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getByText('Both require evidence checks.')).toBeInTheDocument();
  });

  it('uses the resizable wide layout only when the comparison container is wide enough', async () => {
    mockedUseSourceComparison.mockReturnValue(baseHookState);

    class WideResizeObserver {
      private callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback([
          { contentRect: { width: 800 } } as ResizeObserverEntry,
        ], this as unknown as ResizeObserver);
      }

      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', WideResizeObserver);

    try {
      render(<SourceComparisonView sources={sources} notebookId="notebook-1" onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByTestId('wide-source-comparison-layout')).toBeInTheDocument());
      expect(screen.queryByTestId('compact-source-comparison-layout')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
