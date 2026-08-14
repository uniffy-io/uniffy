import { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { Select, type SelectOption } from "@/components/ui/select";
import { roleLabel } from "@/shared/utils/contentRoles";

const ALL_ROLES: ContentRole[] = [
  ContentRole.VIEWER,
  ContentRole.COMMENTER,
  ContentRole.EDITOR,
  ContentRole.ADMIN,
  ContentRole.OWNER,
  ContentRole.BLOCKED,
];

interface ContentRoleSelectProps {
  value: ContentRole | number;
  onChange: (role: ContentRole) => void;
  excludeRoles?: ContentRole[];
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function ContentRoleSelect({
  value,
  onChange,
  excludeRoles = [],
  disabled,
  className,
  size = "sm",
}: ContentRoleSelectProps) {
  const options: SelectOption<number>[] = ALL_ROLES.filter((r) => !excludeRoles.includes(r)).map(
    (r) => ({
      value: r,
      label: roleLabel(r),
    }),
  );

  return (
    <Select<number>
      value={value}
      onChange={(v) => onChange(v as ContentRole)}
      options={options}
      disabled={disabled}
      className={className}
      size={size}
    />
  );
}
