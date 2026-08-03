import { Component, ErrorInfo, ReactNode } from "react";
import ErrorFallback from "./ErrorFallback";

export interface ErrorBoundaryProps {
  children: ReactNode;
  variant?: "page" | "component";
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  title?: string;
  message?: string;
  showHomeButton?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);

    if (import.meta.env.DEV) {
      console.group("Error Boundary Details");
      console.error("Error:", error);
      console.error("Component Stack:", errorInfo.componentStack);
      console.groupEnd();
    }
  }
  resetError = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;

    const {
      children,
      fallback,
      variant = "component",
      title,
      message,
      showHomeButton,
    } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <ErrorFallback
          error={error ?? undefined}
          resetError={this.resetError}
          variant={variant}
          title={title}
          message={message}
          showHomeButton={showHomeButton}
        />
      );
    }

    return children;
  }
}

export default ErrorBoundary;
