// Build 122 — one of the owner's marketing tools (public/marketing-tools), shown inside the app's frame.
// The tool runs as its own page (its own styles and scripts), so it is framed rather than merged into the app;
// "Open in a new tab" gives it the whole window.
export function MarketingToolFrame({ title, src, note }: { title: string; src: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2" style={{ height: 'calc(100dvh - 7rem)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {note && <p className="text-xs text-slate-500">{note}</p>}
        </div>
        <a href={src} target="_blank" rel="noopener" className="rounded border bg-white px-3 py-1.5 text-sm">Open in a new tab ↗</a>
      </div>
      <iframe title={title} src={src} className="min-h-[32rem] w-full flex-1 rounded-lg border bg-white" />
    </div>
  );
}
