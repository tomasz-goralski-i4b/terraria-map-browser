// Placeholder: the canvas and the renderer backend are attached here by later issues.
export function MapView({ renderer }: { readonly renderer: string }): React.JSX.Element {
  return (
    <main className="map-view" aria-label="Map" data-renderer={renderer}>
      <p>No world loaded.</p>
    </main>
  );
}
