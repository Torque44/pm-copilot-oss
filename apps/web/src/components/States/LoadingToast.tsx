// LoadingToast — small floating "fetching grounding…" indicator.

export interface LoadingToastProps {
  label?: string;
}

export function LoadingToast({ label = 'fetching grounding…' }: LoadingToastProps) {
  return (
    <div className="loading-toast">
      <span className="dot running" /> <span className="mono">{label}</span>
    </div>
  );
}
