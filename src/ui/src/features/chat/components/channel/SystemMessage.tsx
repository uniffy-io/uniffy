interface SystemMessageProps {
  text: string;
}

export function SystemMessage({ text }: SystemMessageProps) {
  return (
    <div className="flex justify-center py-2">
      <span className="text-xs text-muted-foreground">{text}</span>
    </div>
  );
}
