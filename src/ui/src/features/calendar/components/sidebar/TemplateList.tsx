/**
 * TemplateList - List of event templates for quick creation
 */

import { useAppDispatch } from '@/app/hooks';
import { DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { openCreateTemplateModal, openEventModal } from '../../store';
import { SidebarSection } from './SidebarSection';
import { DEFAULT_TEMPLATES, getTemplateById } from '../../constants';

export function TemplateList() {
  const dispatch = useAppDispatch();

  const handleTemplateClick = (templateId: string) => {
    const template = getTemplateById(templateId);
    if (template) {
      dispatch(
        openEventModal({
          mode: 'create',
          prefill: {
            categoryId: template.categoryId,
          },
        })
      );
    }
  };

  return (
    <SidebarSection
      id="templates"
      title="Templates"
    >
      <div className="space-y-1">
        {DEFAULT_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => handleTemplateClick(template.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <DocumentDuplicateIcon className="w-4 h-4" />
            <span>{template.name}</span>
          </button>
        ))}

        {/* Create Template button */}
        <button
          type="button"
          onClick={() => dispatch(openCreateTemplateModal())}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <DocumentDuplicateIcon className="w-4 h-4" />
          <span>+ Create Template</span>
        </button>
      </div>
    </SidebarSection>
  );
}
