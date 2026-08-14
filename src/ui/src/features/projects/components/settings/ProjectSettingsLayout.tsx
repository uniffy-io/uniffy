import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  Gear,
  CirclesThree,
  Columns,
  StackSimple,
  Lightning,
  Warning,
  ArrowLeft,
  Users,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { roleCanManage } from "@/shared/utils/contentRoles";
import { GeneralSection } from "@/features/projects/components/settings/GeneralSection";
import { StatusesSection } from "@/features/projects/components/settings/StatusesSection";
import { CustomFieldsSection } from "@/features/projects/components/settings/CustomFieldsSection";
import { TaskTypesSection } from "@/features/projects/components/settings/TaskTypesSection";
import { SprintsSection } from "@/features/projects/components/settings/SprintsSection";
import { MembersSection } from "@/features/projects/components/settings/MembersSection";
import { DangerZoneSection } from "@/features/projects/components/settings/DangerZoneSection";
import { AuditLogSection } from "@/features/projects/components/settings/AuditLogSection";
import type { Project } from "@/features/projects/types";

type SettingsSection =
  | "general"
  | "members"
  | "statuses"
  | "fields"
  | "types"
  | "sprints"
  | "audit"
  | "danger";

interface SectionDef {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
  danger?: boolean;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "members", label: "Access & Members", icon: Users },
  { id: "statuses", label: "Statuses", icon: CirclesThree },
  { id: "fields", label: "Custom Fields", icon: Columns },
  { id: "types", label: "Task Types", icon: StackSimple },
  { id: "sprints", label: "Sprints", icon: Lightning },
  { id: "audit", label: "Access History", icon: ClockCounterClockwise, adminOnly: true },
  { id: "danger", label: "Danger Zone", icon: Warning, danger: true },
];

const ALL_SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

interface ProjectSettingsLayoutProps {
  project: Project;
}

export function ProjectSettingsLayout({ project }: ProjectSettingsLayoutProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const canManage = roleCanManage(project.userRole);

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || canManage);

  // Sync URL param to state
  useEffect(() => {
    const section = searchParams.get("section");
    if (section && ALL_SECTION_IDS.has(section)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing URL search param to local state on navigation
      setActiveSection(section as SettingsSection);
    }
  }, [searchParams]);

  const handleSectionChange = (section: SettingsSection) => {
    setActiveSection(section);
    setSearchParams({ section }, { replace: true });
  };

  const renderContent = () => {
    switch (activeSection) {
      case "general":
        return <GeneralSection project={project} />;
      case "members":
        return <MembersSection project={project} />;
      case "statuses":
        return <StatusesSection project={project} />;
      case "fields":
        return <CustomFieldsSection project={project} />;
      case "types":
        return <TaskTypesSection project={project} />;
      case "sprints":
        return <SprintsSection project={project} />;
      case "audit":
        return <AuditLogSection project={project} />;
      case "danger":
        return <DangerZoneSection project={project} />;
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-8">
      {/* Sidebar */}
      <aside className="w-full md:w-56 lg:w-64 shrink-0">
        <nav className="flex md:flex-col gap-2 md:gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {/* Back link */}
          <Link
            to={`/projects/${project.id}`}
            className="hidden md:flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft size={16} />
            Back to project
          </Link>

          {/* Section label */}
          <div className="hidden md:block px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Settings
          </div>

          {/* Section nav buttons */}
          <div className="flex md:flex-col gap-1 shrink-0">
            {visibleSections.map(({ id, label, icon: Icon, danger }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "flex items-center gap-2 md:gap-3 w-auto md:w-full px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                  activeSection === id
                    ? "bg-primary text-primary-foreground"
                    : danger
                      ? "text-red-500 hover:bg-red-500/10"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => handleSectionChange(id)}
              >
                <Icon size={18} weight="duotone" className="shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-8">{renderContent()}</main>
    </div>
  );
}
