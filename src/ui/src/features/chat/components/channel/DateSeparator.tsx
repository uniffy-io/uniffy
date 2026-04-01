interface DateSeparatorProps {
  label: string;
}

export function DateSeparator({ label }: DateSeparatorProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-4 px-4 py-2 bg-background/95 backdrop-blur-sm">
      <div className="flex-1 border-t border-border" />
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  );
}
