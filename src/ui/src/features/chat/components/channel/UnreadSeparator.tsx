export function UnreadSeparator() {
  return (
    <div className="flex items-center gap-4 px-4 py-2">
      <div className="flex-1 border-t border-primary/50" />
      <span className="text-xs font-medium text-primary whitespace-nowrap">New messages</span>
      <div className="flex-1 border-t border-primary/50" />
    </div>
  );
}
