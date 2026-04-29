// ErrorState — full-panel error fallback (used outside the panel-internal error).

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'something went wrong',
  message = 'no response from grounding pipeline.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="panel-error">
      <div className="panel-error-head">{title}</div>
      <div className="panel-error-body">
        {message}{' '}
        {onRetry && (
          <a
            className="link"
            onClick={(e) => {
              e.preventDefault();
              onRetry();
            }}
          >
            retry
          </a>
        )}
      </div>
    </div>
  );
}
