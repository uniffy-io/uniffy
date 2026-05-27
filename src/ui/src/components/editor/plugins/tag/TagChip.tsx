interface TagChipProps {
  name: string;
  selected?: boolean;
}

export function TagChip({ name, selected = false }: TagChipProps) {
  return (
    <span
      className={`
        tag-chip group inline-flex items-center gap-0.5
        px-2.5 py-1 mx-0.5
        rounded-md
        cursor-pointer
        transition-all duration-150 ease-out
        ${selected ? 'ring-1 ring-primary/50 ring-offset-1 ring-offset-background' : ''}
      `}
      title={`View tag: #${name}`}
    >
      <span className="tag-chip-hash text-[0.85em] font-semibold leading-none transition-colors duration-150">
        #
      </span>
      <span className="tag-chip-name text-[0.9em] font-semibold leading-none truncate max-w-[160px]">
        {name}
      </span>
    </span>
  );
}
