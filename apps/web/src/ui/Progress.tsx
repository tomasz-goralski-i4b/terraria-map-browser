export interface ProgressProps {
  /** Done so far, 0–1. */
  readonly fraction: number;
  /** The duration is unknown: a sweeping stripe instead of a fill. */
  readonly waiting?: boolean;
}

/**
 * The fill of a progress display, positioned over its container. Every progress in the app draws with it, so a
 * button and a bar showing the same work move in step.
 */
export function ProgressFill({ fraction, waiting = false }: ProgressProps): React.JSX.Element {
  return (
    <span
      className="progress-fill" aria-hidden="true" data-waiting={waiting || undefined}
      style={{ "--progress": String(waiting ? 0 : fraction) } as React.CSSProperties}
    />
  );
}

/** A small inline progress bar (`role="progressbar"`). */
export function ProgressBar({ label, title, fraction, waiting = false }: ProgressProps & { readonly label: string; readonly title?: string }): React.JSX.Element {
  return (
    <span
      className="progress-bar" role="progressbar" aria-label={label} title={title} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={waiting ? undefined : Math.round(fraction * 100)}
    >
      <ProgressFill fraction={fraction} waiting={waiting} />
    </span>
  );
}
