/** The app's one icon set: 16 px, 1.5 px strokes on a 16-unit grid, drawn in `currentColor`. */
const PATHS = {
  menu: "M2.5 4h11M2.5 8h11M2.5 12h11",
  pan: "M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2",
  inspect: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5M7 4.5v5M4.5 7h5",
  brush: "M13.5 2.5 7 9M7 9c-1.5-.5-3 .5-3 2s-1 2-2.5 2.5C3 15 6 15 7 13.5c.8-1.2.5-3 0-4.5Z",
  erase: "M6 13.5h7.5M2.8 9.7l6-6a1 1 0 0 1 1.4 0l3.1 3.1a1 1 0 0 1 0 1.4L7.6 13.5H5.4L2.8 10.9a.9.9 0 0 1 0-1.2ZM5.5 7l4 4",
  fill: "M3 8.5 8.5 3l5 5-5.5 5.5a1 1 0 0 1-1.4 0L3 9.9a1 1 0 0 1 0-1.4ZM3 8.5h10.5M14 11.5s1 1.3 1 2a1 1 0 0 1-2 0c0-.7 1-2 1-2Z",
  select: "M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11M7 2.5h2M7 13.5h2M2.5 7v2M13.5 7v2",
  picker: "M10 2.5l3.5 3.5M12 4.5l-7.5 7.5L2 14l2-2.5L11.5 4M9 3.5l3.5 3.5",
  object: "M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3ZM2.5 5.5 8 8.5l5.5-3M8 8.5v5",
  chevron: "M6 4l4 4-4 4",
  expandAll: "M4.5 3.5 8 7l3.5-3.5M4.5 9 8 12.5 11.5 9",
  collapseAll: "M4.5 7 8 3.5 11.5 7M4.5 12.5 8 9l3.5 3.5",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  eyeOff: "M2 2l12 12M6.6 3.7A6 6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M4.2 4.9A11 11 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.7-.6",
  dock: "M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM10 3v10",
  help: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM6.2 6.2A1.9 1.9 0 0 1 8 4.8c1.1 0 1.9.8 1.9 1.7 0 1.5-1.9 1.5-1.9 3M8 11.3v.2",
  theme: "M8 14.5a6.5 6.5 0 1 0 0-13v13Z M8 1.5a6.5 6.5 0 0 1 0 13",
  columns: "M2.5 3h11v10h-11ZM6.5 3v10M10 3v10",
  grid: "M2.5 2.5h4.5v4.5h-4.5ZM9 2.5h4.5v4.5H9ZM2.5 9h4.5v4.5h-4.5ZM9 9h4.5v4.5H9Z",
  list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5",
  target: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 .5v2M8 13.5v2M.5 8h2M13.5 8h2",
  copy: "M5.5 5.5h7v8h-7ZM3.5 10.5v-8h7",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  check: "M3 8.5l3 3 7-7",
  sortAsc: "M8 3.5 4.5 8h7Z",
  sortDesc: "M8 12.5 4.5 8h7Z",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM10.5 10.5 14 14",
  command: "M5 2.5a2.5 2.5 0 1 0 0 5h6a2.5 2.5 0 1 0 0-5v11a2.5 2.5 0 1 0 0-5H5a2.5 2.5 0 1 0 0 5Z",
  stats: "M2.5 13.5h11M4 11V8M7 11V4M10 11V6.5M13 11V9",
  reset: "M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5",
  undo: "M6 3 2.5 6.5 6 10M2.5 6.5H9a4 4 0 0 1 0 8",
  redo: "M10 3l3.5 3.5L10 10M13.5 6.5H7a4 4 0 0 0 0 8",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  warning: "M8 2 14.5 13.5h-13ZM8 6.5v3M8 11.5v.01",
  file: "M3.5 1.5h6L13 5v9a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14V2a.5.5 0 0 1 .5-.5ZM9.5 1.5V5H13",
  folder: "M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5Z",
  save: "M3 2.5h8l2.5 2.5v8.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5ZM5 2.5v3h5v-3M5 14v-4.5h6V14",
  download: "M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11",
  clock: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5",
  world: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM1.5 8h13M8 1.5c2 2 2.5 4 2.5 6.5S10 12.5 8 14.5C6 12.5 5.5 10.5 5.5 8S6 3.5 8 1.5",
  info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 7v4.5M8 4.75v.01",
  lock: "M4 7h8a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-6A.5.5 0 0 1 4 7ZM5.5 7V5a2.5 2.5 0 0 1 5 0v2",
  plus: "M8 3v10M3 8h10",
  hammer: "M7 2.5h4.5l1.5 1.5v2.5H7ZM9 6.5v7.5",
  roller: "M3 2.5h9a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1ZM13 4.5h1.5V8H8v2M7 10h2v4.5H7Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { readonly name: IconName; readonly className?: string }): React.JSX.Element {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
