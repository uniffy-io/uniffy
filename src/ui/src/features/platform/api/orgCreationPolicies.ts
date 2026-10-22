import type { SelectOption } from "@/components/ui/select";
import { OrgCreationPolicy } from "@uniffy/proto/superadmin/v1/system_config_pb";

/** Who may create organizations from the app, widest last; operators always may. */
export const ORG_CREATION_POLICY_OPTIONS: SelectOption<OrgCreationPolicy>[] = [
  { value: OrgCreationPolicy.OPERATORS_ONLY, label: "Platform operators only" },
  { value: OrgCreationPolicy.OPERATORS_AND_OWNERS, label: "Operators and organization owners" },
  { value: OrgCreationPolicy.MEMBERS, label: "Anyone with a membership" },
  { value: OrgCreationPolicy.ANYONE, label: "Any signed-in user" },
];
