import { useId } from "react";
import { Icon } from "./Icon.js";

export interface SectionProps {
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 2 for dock sections, 3 for groups inside them. */
  readonly level?: 2 | 3;
  /** Small controls on the header's right (they never toggle the section). */
  readonly actions?: React.ReactNode;
  /** Short text after the title, e.g. a count. */
  readonly badge?: string;
  readonly children: React.ReactNode;
}

/**
 * One accordion item (WAI-ARIA accordion pattern): a heading whose button toggles a labelled region. Several may be
 * open. A collapsed section does not render its body, so its work (tables, counts) costs nothing until opened.
 */
export function Section({ title, open, onOpenChange, level = 2, actions, badge, children }: SectionProps): React.JSX.Element {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`section section-level-${String(level)}`} data-open={open}>
      <div className="section-header">
        <Heading className="section-heading">
          <button
            type="button"
            id={`${id}-button`}
            className="section-toggle"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => {
              onOpenChange(!open);
            }}
          >
            <Icon name="chevron" className="section-chevron" />
            <span className="section-title">{title}</span>
            {badge !== undefined && <span className="section-badge">{badge}</span>}
          </button>
        </Heading>
        {actions !== undefined && <div className="section-actions">{actions}</div>}
      </div>
      <div id={`${id}-body`} role="region" aria-labelledby={`${id}-button`} className="section-body" hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
