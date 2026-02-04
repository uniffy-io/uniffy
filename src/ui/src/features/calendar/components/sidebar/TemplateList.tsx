/**
 * TemplateList - List of event templates for quick creation
 */

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { CopySimple, Plus, PencilSimple, Trash } from '@phosphor-icons/react';
import { openCreateTemplateModal, openEditTemplateModal, openEventModal } from '@/features/calendar/store';
import { SidebarSection } from '@/features/calendar/components/sidebar/SidebarSection';
import { listEventTemplates, deleteEventTemplate } from '@/features/calendar/store/calendarThunks';
import { useEffect } from 'react';

export function TemplateList() {
  const dispatch = useAppDispatch();
  const templates = useAppSelector((state) => state.calendar.templates);
  const isLoading = useAppSelector((state) => state.calendar.loading.templates);

  useEffect(() => {
    dispatch(listEventTemplates());
  }, [dispatch]);

  const handleTemplateClick = (templateId: string) => {
    const template = templates[templateId];
    if (template) {
      dispatch(
        openEventModal({
          mode: 'create',
          prefill: {
            title: template.title,
            description: template.description,
            categoryId: template.categoryId,
            location: template.location,
            meetingUrl: template.meetingUrl,
            tags: template.tags,
            durationMinutes: template.durationMinutes,
          },
        })
      );
    }
  };

  const handleEdit = (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    dispatch(openEditTemplateModal(templateId));
  };

  const handleDelete = async (e: React.MouseEvent, templateId: string, title: string) => {
    e.stopPropagation();
    if (window.confirm(`Delete template "${title}"?`)) {
        await dispatch(deleteEventTemplate(templateId));
    }
  };

  const templateList = Object.values(templates);

  return (
    <SidebarSection
      id="templates"
      title="Templates"
      action={
        <button
          onClick={(e) => {
            e.stopPropagation();
            dispatch(openCreateTemplateModal());
          }}
          className="p-0.5 rounded hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
          title="Create Template"
        >
          <Plus size={14} weight="bold" />
        </button>
      }
    >
      <div className="space-y-1">
        {templateList.map((template) => (
          <div
            key={template.id}
            onClick={() => handleTemplateClick(template.id)}
            className="group w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm hover:bg-muted transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 overflow-hidden">
                <CopySimple size={16} weight="duotone" className="shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground group-hover:text-foreground transition-colors">{template.title}</span>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => handleEdit(e, template.id)}
                    className="p-0.5 hover:bg-background rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit"
                >
                    <PencilSimple size={14} weight="duotone" />
                </button>
                <button
                    onClick={(e) => handleDelete(e, template.id, template.title)}
                    className="p-0.5 hover:bg-background rounded text-muted-foreground hover:text-red-500 transition-colors"
                    title="Delete"
                >
                    <Trash size={14} weight="duotone" />
                </button>
            </div>
          </div>
        ))}

        {templateList.length === 0 && !isLoading && (
            <div className="text-xs text-muted-foreground px-2 py-1 italic">
                No templates yet
            </div>
        )}
      </div>
    </SidebarSection>
  );
}
