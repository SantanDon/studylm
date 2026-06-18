import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInput from '@/components/chat/ChatInput';

describe('ChatInput Component', () => {
  const mockOnMessageChange = vi.fn();
  const mockOnSend = vi.fn();
  const mockOnExampleQuestionClick = vi.fn();

  const defaultProps = {
    message: '',
    onMessageChange: mockOnMessageChange,
    onSend: mockOnSend,
    disabled: false,
    isLoading: false,
    sourceCount: 3,
    exampleQuestions: [],
    onExampleQuestionClick: mockOnExampleQuestionClick,
    placeholder: 'Start typing...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input field with placeholder', () => {
    render(<ChatInput {...defaultProps} />);
    const input = screen.getByPlaceholderText('Start typing...');
    expect(input).toBeInTheDocument();
  });

  it('displays source count', () => {
    render(<ChatInput {...defaultProps} sourceCount={5} />);
    expect(screen.getByText('5 sources')).toBeInTheDocument();
  });

  it('displays singular source when count is 1', () => {
    render(<ChatInput {...defaultProps} sourceCount={1} />);
    expect(screen.getByText('1 source')).toBeInTheDocument();
  });

  it('calls onMessageChange when input value changes', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const input = screen.getByPlaceholderText('Start typing...');
    await user.type(input, 'Hello');
    
    expect(mockOnMessageChange).toHaveBeenCalled();
  });

  it('calls onSend when send button is clicked', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} message="Hello" />);
    
    const sendButton = screen.getByRole('button', { name: '' });
    await user.click(sendButton);
    
    expect(mockOnSend).toHaveBeenCalled();
  });

  it('calls onSend when Enter key is pressed', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} message="Hello" />);
    
    const input = screen.getByPlaceholderText('Start typing...');
    await user.type(input, '{Enter}');
    
    expect(mockOnSend).toHaveBeenCalled();
  });

  it('disables send button when message is empty', () => {
    render(<ChatInput {...defaultProps} message="" />);
    
    const sendButton = screen.getByRole('button', { name: '' });
    expect(sendButton).toBeDisabled();
  });

  it('disables send button when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} message="Hello" disabled={true} />);
    
    const sendButton = screen.getByRole('button', { name: '' });
    expect(sendButton).toBeDisabled();
  });

  it('disables send button when isLoading is true', () => {
    render(<ChatInput {...defaultProps} message="Hello" isLoading={true} />);
    
    const sendButton = screen.getByRole('button', { name: '' });
    expect(sendButton).toBeDisabled();
  });

  it('disables input when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} disabled={true} />);
    
    const input = screen.getByPlaceholderText('Start typing...');
    expect(input).toBeDisabled();
  });

  it('renders example questions carousel', () => {
    const questions = ['What is AI?', 'How does ML work?', 'What is deep learning?'];
    render(
      <ChatInput
        {...defaultProps}
        exampleQuestions={questions}
      />
    );

    questions.forEach((question) => {
      expect(screen.getByText(question)).toBeInTheDocument();
    });
  });

  it('calls onExampleQuestionClick when example question is clicked', async () => {
    const user = userEvent.setup();
    const questions = ['What is AI?'];
    render(
      <ChatInput
        {...defaultProps}
        exampleQuestions={questions}
      />
    );

    const questionButton = screen.getByText('What is AI?');
    await user.click(questionButton);

    expect(mockOnExampleQuestionClick).toHaveBeenCalledWith('What is AI?');
  });

  it('does not render example questions when disabled', () => {
    const questions = ['What is AI?'];
    render(
      <ChatInput
        {...defaultProps}
        disabled={true}
        exampleQuestions={questions}
      />
    );

    // Questions should not be visible when disabled
    const questionButton = screen.queryByText('What is AI?');
    expect(questionButton).not.toBeInTheDocument();
  });

  it('shows loading spinner when isLoading is true', () => {
    const { container } = render(
      <ChatInput {...defaultProps} isLoading={true} />
    );

    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('uses custom placeholder text', () => {
    render(
      <ChatInput
        {...defaultProps}
        placeholder="Custom placeholder"
      />
    );

    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });
});
