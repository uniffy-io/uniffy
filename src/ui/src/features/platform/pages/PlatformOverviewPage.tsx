import { Link } from "react-router-dom";
import {
  Buildings,
  Users,
  Envelope,
  Key,
  ClipboardText,
  HardDrives,
  Lifebuoy,
  SquaresFour,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

interface OverviewCard {
  title: string;
  description: string;
  path: string;
  icon: Icon;
}

const cards: OverviewCard[] = [
  {
    title: "Organizations",
    description: "Browse tenants, plans, mail and encryption status.",
    path: "/platform/organizations",
    icon: Buildings,
  },
  {
    title: "Users",
    description: "Search every user, manage system-admin grants, force-logout.",
    path: "/platform/users",
    icon: Users,
  },
  {
    title: "Support Sessions",
    description: "Active and past time-bound grants into tenant orgs.",
    path: "/platform/sessions",
    icon: Lifebuoy,
  },
  {
    title: "Mail",
    description: "System mail config, per-org mail health, deliveries, suppressions.",
    path: "/platform/mail",
    icon: Envelope,
  },
  {
    title: "Encryption",
    description: "DEK rotation status, master KEK presence, re-encrypt queue.",
    path: "/platform/encryption",
    icon: Key,
  },
  {
    title: "Audit",
    description: "Platform-scope audit: auth, org lifecycle, support sessions.",
    path: "/platform/audit",
    icon: ClipboardText,
  },
  {
    title: "Server Settings",
    description: "Deployment-wide configuration toggles.",
    path: "/platform/server-settings",
    icon: HardDrives,
  },
];

export function PlatformOverviewPage() {
  useDocumentTitle("Platform");

  return (
    <div className="flex flex-col gap-6 max-w-3xl w-full mx-auto">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <SquaresFour size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">Platform overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-tenant operator surface. Tenant content is not visible here unless a support
            session is active.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.path}
              to={c.path}
              className="group rounded-xl bg-surface p-4 shadow-edge transition-shadow duration-150 hover:shadow-edge-strong"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon size={20} weight="duotone" className="text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-foreground">{c.title}</span>
              </div>
              <p className="text-xs text-muted-foreground">{c.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
