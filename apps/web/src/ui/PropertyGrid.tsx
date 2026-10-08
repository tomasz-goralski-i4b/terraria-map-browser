import { useRef, useState } from "react";
import { Icon } from "./Icon.js";

export type Property =
  | { readonly kind: "text"; readonly label: string; readonly value: string }
  | { readonly kind: "flag"; readonly label: string; readonly value: boolean }
  | { readonly kind: "custom"; readonly label: string; readonly value: React.ReactNode };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // no permission or no clipboard (insecure context): the value stays selectable
  }
}

/**
 * Label/value rows. Text values copy on click (the value is the button), with the result announced in a polite live
 * region; flags read as Yes/No and show a check or a dash, so a checklist (bosses) scans at a glance.
 */
export function PropertyGrid({ properties, label }: { readonly properties: readonly Property[]; readonly label?: string }): React.JSX.Element {
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<number | null>(null);

  const copy = (property: { readonly label: string; readonly value: string }): void => {
    void copyText(property.value).then((copied) => {
      setAnnouncement(copied ? `Copied ${property.label}` : `Could not copy ${property.label}`);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setAnnouncement("");
      }, 1500);
    });
  };

  return (
    <div className="property-grid">
      <dl aria-label={label}>
        {properties.map((property) => (
          <div className="property-row" key={property.label}>
            <dt>{property.label}</dt>
            <dd>
              {property.kind === "text" && (
                <button type="button" className="property-value" title="Click to copy" onClick={() => {
                  copy(property);
                }}>
                  {property.value}
                </button>
              )}
              {property.kind === "flag" && (
                <span className="property-flag" data-value={property.value}>
                  <Icon name={property.value ? "check" : "close"} />
                  {property.value ? "Yes" : "No"}
                </span>
              )}
              {property.kind === "custom" && property.value}
            </dd>
          </div>
        ))}
      </dl>
      <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
