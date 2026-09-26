import {
  CalendarBlank,
  Clock,
  Flag,
  Hash,
  Lightning,
  Link,
  ListBullets,
  ListChecks,
  Prohibit,
  Shapes,
  Tag,
  TextT,
  ToggleLeft,
  TreeStructure,
  User,
  Users,
} from "@phosphor-icons/react";
import type { SelectOption } from "@/components/ui/select";
import type { FieldDefinition } from "@/features/projects/types";
import type { ViewCatalog, ViewFieldRef } from "@/features/projects/types/views";
import { groupableFields } from "@/features/projects/utils/groupTasks";
import {
  FILTERABLE_PSEUDO_FIELDS,
  capabilitiesOf,
  fieldKindOf,
  fieldRef,
  fieldRefKey,
  fieldRefLabel,
  pseudoRef,
  type FieldKind,
} from "@/features/projects/utils/viewFields";

const KIND_ICONS: Record<FieldKind, typeof TextT> = {
  text: TextT,
  number: Hash,
  single_select: ListBullets,
  multi_select: ListChecks,
  date: CalendarBlank,
  timestamp: Clock,
  person: Users,
  single_person: User,
  tags: Tag,
  sprint: Lightning,
  task_type: Shapes,
  task_ref: TreeStructure,
  task_ref_set: Prohibit,
  epic: Flag,
  boolean: ToggleLeft,
  reference: Link,
};

/** Every field and task attribute the catalog lets a view filter on, with its type icon. */
export function filterFieldOptions(
  fields: FieldDefinition[],
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  catalog: ViewCatalog,
): SelectOption[] {
  const option = (ref: ViewFieldRef): SelectOption | null => {
    const kind = fieldKindOf(ref, fieldsById);
    if (!kind || !capabilitiesOf(ref, fieldsById, catalog)?.operators.length) return null;
    const Icon = KIND_ICONS[kind];
    return {
      value: fieldRefKey(ref),
      label: fieldRefLabel(ref, fieldsById),
      icon: <Icon size={14} className="text-muted-foreground shrink-0" />,
    };
  };
  return [
    ...fields.map((field) => option(fieldRef(field.id))),
    ...FILTERABLE_PSEUDO_FIELDS.map((pseudo) => option(pseudoRef(pseudo))),
  ].filter((entry): entry is SelectOption => entry !== null);
}

/** Every field the catalog lets a view group by, in the grouping menu's order, with its type icon. */
export function groupFieldOptions(
  fields: FieldDefinition[],
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  catalog: ViewCatalog | null,
): SelectOption[] {
  return groupableFields(fields, catalog).map(({ ref, key, label }) => {
    const kind = fieldKindOf(ref, fieldsById);
    const Icon = kind ? KIND_ICONS[kind] : TextT;
    return {
      value: key,
      label,
      icon: <Icon size={14} className="text-muted-foreground shrink-0" />,
    };
  });
}
