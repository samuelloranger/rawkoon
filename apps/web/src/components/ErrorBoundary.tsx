import { Component, ErrorInfo, ReactNode } from "react";
import i18next from "i18next";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full space-y-4 text-center">
            <h1 className="text-2xl font-bold text-neutral-100">
              {i18next.t("common.somethingWentWrong")}
            </h1>
            <p className="text-neutral-400">
              {this.state.error?.message || i18next.t("common.unexpectedError")}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              {i18next.t("common.reloadPage")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export class CardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("CardErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="relative overflow-hidden rounded-3xl border border-neutral-700/60 bg-neutral-800/60 p-4 shadow-sm flex items-center justify-center min-h-[80px]">
          <p className="text-xs text-neutral-500">
            {i18next.t("common.failedToLoad")}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
