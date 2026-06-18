import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatHeader from '@/components/chat/ChatHeader';

// Mock TutorSelector
vi.mock('@/components/notebook/TutorSelector', () => ({
  TutorSelector: ({ onTutorSelect, disabled }: { onTutorSelect: (id: string) => void; disabled?: boolean }) => (
    <button
      data-testid="tutor-selector"
      onClick={() => onTutorSelect('tutor-1')}
      disabled={disabled}
    >
      Select Tutor
    </button>
  ),
}));

// Mock getTutorById
vi.mock('@/config/tutors', () => ({
  getTutorById: (_id: string) => ({
    name: 'Test Tutor',
    avatarIcon: '👨‍🏫',
  }),
}));

describe('ChatHeader Component', () => {
  const defaultProps = {
    title: 'Chat',
    isStudyMode: false,
    selectedTutorId: 'default',
    onTutorSelect: vi.fn(),
    youtubeSource: null,
    onOpenVideoChat: vi.fn(),
    shouldShowRefreshButton: false,
    onRefreshChat: vi.fn(),
    isDeletingChatHistory: false,
    isChatDisabled: false,
    isSending: false,
    hasPendingMessage: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title correctly', () => {
    render(<ChatHeader {...defaultProps} title="My Chat" />);
    expect(screen.getByText('My Chat')).toBeInTheDocument();
  });

  it('renders tutor selector', () => {
    render(<ChatHeader {...defaultProps} />);
    expect(screen.getByTestId('tutor-selector')).toBeInTheDocument();
  });

  it('shows tutor badge when tutor is selected', () => {
    render(
      <ChatHeader
        {...defaultProps}
        selectedTutorId="tutor-123"
      />
    );

    expect(screen.getByText(/Teaching as/)).toBeInTheDocument();
    expect(screen.getByText('Test Tutor')).toBeInTheDocument();
  });

  it('does not show tutor badge when default tutor is selected', () => {
    render(
      <ChatHeader
        {...defaultProps}
        selectedTutorId="default"
      />
    );

    expect(screen.queryByText(/Teaching as/)).not.toBeInTheDocument();
  });

  it('shows video chat button when youtube source is available', async () => {
    const user = userEvent.setup();
    const mockOnOpenVideoChat = vi.fn();

    render(
      <ChatHeader
        {...defaultProps}
        youtubeSource={{
          url: 'https://youtube.com/watch?v=123',
          title: 'Test Video',
          sourceId: 'source-1',
        }}
        onOpenVideoChat={mockOnOpenVideoChat}
      />
    );

    const videoButton = screen.getByText('Watch & Chat');
    expect(videoButton).toBeInTheDocument();

    await user.click(videoButton);
    expect(mockOnOpenVideoChat).toHaveBeenCalledWith({
      url: 'https://youtube.com/watch?v=123',
      title: 'Test Video',
      sourceId: 'source-1',
    });
  });

  it('does not show video chat button when youtube source is not available', () => {
    render(
      <ChatHeader
        {...defaultProps}
        youtubeSource={null}
      />
    );

    expect(screen.queryByText('Watch & Chat')).not.toBeInTheDocument();
  });

  it('shows refresh button when shouldShowRefreshButton is true', async () => {
    const user = userEvent.setup();
    const mockOnRefreshChat = vi.fn();

    render(
      <ChatHeader
        {...defaultProps}
        shouldShowRefreshButton={true}
        onRefreshChat={mockOnRefreshChat}
      />
    );

    const refreshButton = screen.getByText('Clear Chat');
    expect(refreshButton).toBeInTheDocument();

    await user.click(refreshButton);
    expect(mockOnRefreshChat).toHaveBeenCalled();
  });

  it('shows loading state on refresh button', () => {
    render(
      <ChatHeader
        {...defaultProps}
        shouldShowRefreshButton={true}
        isDeletingChatHistory={true}
      />
    );

    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('disables refresh button when chat is disabled', () => {
    render(
      <ChatHeader
        {...defaultProps}
        shouldShowRefreshButton={true}
        isChatDisabled={true}
      />
    );

    const refreshButton = screen.getByRole('button', { name: /Clear Chat/i });
    expect(refreshButton).toBeDisabled();
  });

  it('disables tutor selector when sending message', () => {
    render(
      <ChatHeader
        {...defaultProps}
        isSending={true}
      />
    );

    const tutorSelector = screen.getByTestId('tutor-selector');
    expect(tutorSelector).toBeDisabled();
  });

  it('disables tutor selector when message is pending', () => {
    render(
      <ChatHeader
        {...defaultProps}
        hasPendingMessage={true}
      />
    );

    const tutorSelector = screen.getByTestId('tutor-selector');
    expect(tutorSelector).toBeDisabled();
  });

  it('applies study mode styling', () => {
    const { container } = render(
      <ChatHeader
        {...defaultProps}
        isStudyMode={true}
        title="Video Assistant"
      />
    );

    const header = container.querySelector('[class*="bg-slate-950"]');
    expect(header).toBeInTheDocument();

    expect(screen.getByText('Video Assistant')).toHaveClass('text-slate-100');
  });

  it('applies normal mode styling', () => {
    const { container } = render(
      <ChatHeader
        {...defaultProps}
        isStudyMode={false}
      />
    );

    const header = container.querySelector('[class*="bg-background"]');
    expect(header).toBeInTheDocument();
  });

  it('calls onTutorSelect when tutor is selected', async () => {
    const user = userEvent.setup();
    const mockOnTutorSelect = vi.fn();

    render(
      <ChatHeader
        {...defaultProps}
        onTutorSelect={mockOnTutorSelect}
      />
    );

    const tutorSelector = screen.getByTestId('tutor-selector');
    await user.click(tutorSelector);

    expect(mockOnTutorSelect).toHaveBeenCalledWith('tutor-1');
  });
});
