import { useState } from "react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  toggleCategoryFilter,
  openAddCategoryModal,
  openEditCategoryModal,
  deleteCategory,
} from "@/features/calendar/store";
import { SidebarSection } from "@/features/calendar/components/sidebar/SidebarSection";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/shared/utils/cn";

export function CategoryList() {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const selectedCategoryIds = useAppSelector((state) => state.calendar.filters.categoryIds);

  const handleToggle = (categoryId: string) => {
    dispatch(toggleCategoryFilter(categoryId));
  };

  const handleEdit = (categoryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(openEditCategoryModal(categoryId));
  };

  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = (categoryId: string, categoryName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDelete({ id: categoryId, name: categoryName });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await dispatch(deleteCategory(pendingDelete.id)).unwrap();
      setPendingDelete(null);
    } catch {
    } finally {
      setDeleting(false);
    }
  };

  const categoryArray = Object.values(categories);

  return (
    <SidebarSection
      id="categories"
      title="Categories"
      action={
        <span
          onClick={() => dispatch(openAddCategoryModal())}
          className="p-0.5 rounded hover:bg-muted cursor-pointer"
          title="Add Category"
        >
          <Plus size={14} weight="bold" className="text-muted-foreground" />
        </span>
      }
    >
      <div className="space-y-1">
        {categoryArray.map((category) => {
          const isSelected = selectedCategoryIds.includes(category.id);

          return (
            <div
              key={category.id}
              className={cn(
                "group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                isSelected
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <button
                onClick={() => handleToggle(category.id)}
                className="flex items-center gap-2 flex-1 text-left min-w-0"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: category.color }}
                />
                <span className="truncate">{category.name}</span>
              </button>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                <span
                  onClick={(e) => handleEdit(category.id, e)}
                  className="p-0.5 rounded hover:bg-muted cursor-pointer"
                  title="Edit"
                >
                  <PencilSimple size={14} weight="duotone" className="text-muted-foreground" />
                </span>
                <span
                  onClick={(e) => handleDelete(category.id, category.name, e)}
                  className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                  title="Delete"
                >
                  <Trash size={14} weight="duotone" className="text-destructive" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete category?"
        message={
          pendingDelete
            ? `Delete the "${pendingDelete.name}" category? Events keep their data but lose this label.`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />
    </SidebarSection>
  );
}
