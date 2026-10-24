import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected application error.',
    };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('KadePOS ErrorBoundary caught:', error, info);
  }

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let friendlyDetail = this.state.errorMessage;
    try {
      const parsed = JSON.parse(this.state.errorMessage);
      if (parsed && parsed.error) {
        friendlyDetail = `${parsed.error} (${parsed.operationType || 'db'} on ${parsed.path || 'cloud'})`;
      }
    } catch {
      // Plain text error
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 border border-slate-200">
          <div className="flex items-center gap-3 text-red-700">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h1 className="text-lg font-semibold text-slate-900">
              System Sync Interrupted / දෝෂයක් ඇතිවිය
            </h1>
          </div>
          <p className="mt-3 text-sm text-slate-600 break-words leading-relaxed">
            {friendlyDetail}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reload Terminal / නැවත අරඹන්න</span>
          </button>
        </div>
      </div>
    );
  }
}
