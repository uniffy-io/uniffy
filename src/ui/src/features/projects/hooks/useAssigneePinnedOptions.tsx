import { User, UserCircleDashed } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import type { SubjectPickerPinnedOption } from "@/components/subject";

interface AssigneePinnedOptionsArgs {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Offer a row that clears every assignee, for fields that save on each change. */
  allowUnassigned?: boolean;
}

/** "Assign to me" first, then "Unassigned" where clearing is a choice, for every assignee picker. */
export function useAssigneePinnedOptions({
  value,
  onChange,
  allowUnassigned = false,
}: AssigneePinnedOptionsArgs): SubjectPickerPinnedOption[] {
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const options: SubjectPickerPinnedOption[] = [];
  if (currentUserId) {
    const assigned = value.includes(currentUserId);
    options.push({
      id: "assign-to-me",
      label: "Assign to me",
      icon: <User size={16} className="text-muted-foreground" />,
      selected: assigned,
      subjectId: currentUserId,
      onToggle: () =>
        onChange(assigned ? value.filter((id) => id !== currentUserId) : [...value, currentUserId]),
    });
  }
  if (allowUnassigned) {
    options.push({
      id: "unassigned",
      label: "Unassigned",
      icon: <UserCircleDashed size={16} className="text-muted-foreground" />,
      selected: value.length === 0,
      onToggle: () => {
        if (value.length > 0) onChange([]);
      },
    });
  }
  return options;
}
