import { Icon, type IconName } from "../ui/Icon.js";
import { dismissNotification, useNotifications, type AppNotification } from "./notification-store.js";

const ICONS: Readonly<Record<AppNotification["kind"], IconName>> = { success: "check", info: "info", error: "warning" };

/** The notification stack in the map's bottom-right corner. Errors are alerts; the rest are announced politely. */
export function Notifications(): React.JSX.Element {
  const items = useNotifications((state) => state.items);
  return (
    // One live region that stays mounted: a status region inserted together with its text is often not announced.
    <section className="notifications" aria-label="Notifications" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <div key={item.id} className="notification" data-kind={item.kind} role={item.kind === "error" ? "alert" : undefined}>
          <Icon name={ICONS[item.kind]} className="notification-icon" />
          <div className="notification-text">
            <p className="notification-title">{item.title}</p>
            {item.detail !== undefined && <p className="notification-detail">{item.detail}</p>}
            {item.action !== undefined && (
              <button
                type="button" className="button button-small"
                onClick={() => {
                  dismissNotification(item.id);
                  item.action?.run();
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
          <button
            type="button" className="icon-button notification-close" aria-label="Dismiss notification"
            onClick={() => {
              dismissNotification(item.id);
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </section>
  );
}
