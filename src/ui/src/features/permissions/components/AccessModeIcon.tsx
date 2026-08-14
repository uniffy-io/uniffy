import { Buildings, LockSimple, Users } from "@phosphor-icons/react";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { accessModeLabel } from "@/shared/utils/contentRoles";

interface AccessModeIconProps {
  mode: AccessMode | number;
  size?: number;
  className?: string;
}

export function AccessModeIcon({ mode, size = 14, className }: AccessModeIconProps) {
  const props = { size, className, "aria-label": accessModeLabel(mode) };
  switch (mode) {
    case AccessMode.EXPLICIT_MEMBERS:
      return <Users {...props} />;
    case AccessMode.OPEN_TO_ORG:
      return <Buildings {...props} />;
    default:
      return <LockSimple {...props} />;
  }
}
