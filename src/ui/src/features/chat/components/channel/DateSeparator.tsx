interface DateSeparatorProps {
  label: string;
}

export function DateSeparator({ label }: DateSeparatorProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-4 px-4 py-2">
      <div className="flex-1 border-t border-border/30" />
      <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 border-t border-border/30" />
    </div>
  );
}
