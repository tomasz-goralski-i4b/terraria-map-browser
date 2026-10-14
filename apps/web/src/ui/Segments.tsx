/** Mutually exclusive compact options, sharing the editor's existing segmented controls. */
export function Segments<T extends string>({ label, options, value, disabled, onChange }: {
  readonly label: string;
  readonly options: readonly { readonly id: T; readonly label: React.ReactNode; readonly name?: string; readonly tooltip?: string }[];
  readonly value: T;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  return <div className="brush-segments" role="group" aria-label={label}>
    {options.map((option) => <button key={option.id} type="button" aria-pressed={value === option.id} disabled={disabled}
      {...(option.name === undefined ? {} : { "aria-label": option.name })}
      {...(option.tooltip === undefined ? {} : { "data-tooltip": option.tooltip, "data-tooltip-side": "bottom" })}
      onClick={() => { onChange(option.id); }}>{option.label}</button>)}
  </div>;
}
