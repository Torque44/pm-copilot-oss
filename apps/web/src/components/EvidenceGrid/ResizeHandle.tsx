// ResizeHandle — drag bar between the evidence grid and the chat below it.
//
// Drives a single number (the height of the evidence-grid block in pixels).
// The parent owns the state + persistence; this component just translates
// pointer drags into delta requests.

import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react';

export interface ResizeHandleProps {
  /** Current height of the resizable block, in px. */
  currentHeight: number;
  /** Minimum height the user is allowed to drag down to. */
  min?: number;
  /** Maximum height the user is allowed to drag up to. */
  max?: number;
  /** Called with the new height (already clamped) on every pointer move. */
  onResize: (nextHeight: number) => void;
  /** Called once the drag ends — useful for persisting the value. The
   *  parent already has the latest height via its own state, so no args. */
  onResizeEnd?: () => void;
}

export function ResizeHandle({
  currentHeight,
  min = 200,
  max = 1200,
  onResize,
  onResizeEnd,
}: ResizeHandleProps) {
  const dragState = useRef<{ startY: number; startH: number } | null>(null);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const s = dragState.current;
      if (!s) return;
      const dy = e.clientY - s.startY;
      const next = Math.max(min, Math.min(max, s.startH + dy));
      onResize(next);
    },
    [min, max, onResize],
  );

  const onMouseUp = useCallback(() => {
    const s = dragState.current;
    if (!s) return;
    dragState.current = null;
    document.body.classList.remove('is-resizing-row');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    onResizeEnd?.();
  }, [onMouseMove, onResizeEnd]);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragState.current = { startY: e.clientY, startH: currentHeight };
      document.body.classList.add('is-resizing-row');
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [currentHeight, onMouseMove, onMouseUp],
  );

  return (
    <div
      className="row-resize-handle"
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="horizontal"
      title="drag to resize"
    >
      <div className="row-resize-grip" />
    </div>
  );
}
