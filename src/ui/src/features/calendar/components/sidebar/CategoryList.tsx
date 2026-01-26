/**
 * CategoryList - List of event categories for filtering
 */

import { useState, useRef, useEffect } from 'react';
import { PencilSimple, Plus, Trash, Check, X } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  toggleCategoryFilter,
  openAddCategoryModal,
  updateCategoryThunk,
  deleteCategory,
} from '../../store';
import { SidebarSection } from './SidebarSection';
import { cn } from '@/utils/cn';

export function CategoryList() {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const selectedCategoryIds = useAppSelector(
    (state) => state.calendar.filters.categoryIds
  );

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleToggle = (categoryId: string) => {
    dispatch(toggleCategoryFilter(categoryId));
  };

  const handleStartEdit = (categoryId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(categoryId);
    setEditName(currentName);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) {
      handleCancelEdit();
      return;
    }

    try {
      await dispatch(updateCategoryThunk({
        categoryId: editingId,
        name: editName.trim(),
      })).unwrap();
      handleCancelEdit();
    } catch (error) {
      console.error('Failed to update category:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleDelete = async (categoryId: string, categoryName: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!window.confirm(`Are you sure you want to delete the "${categoryName}" category?`)) {
      return;
    }

    try {
      await dispatch(deleteCategory(categoryId)).unwrap();
    } catch (error) {
      console.error('Failed to delete category:', error);
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
                'group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                isSelected
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {editingId === category.id ? (
                // Edit mode
                <>
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: category.color }}
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveEdit}
                    className="flex-1 bg-transparent border-b border-primary outline-none text-foreground text-sm min-w-0"
                  />
                  <div className="flex items-center gap-0.5">
                    <span
                      onClick={handleSaveEdit}
                      className="p-0.5 rounded hover:bg-muted cursor-pointer"
                      title="Save"
                    >
                      <Check size={14} weight="bold" className="text-green-500" />
                    </span>
                    <span
                      onClick={handleCancelEdit}
                      className="p-0.5 rounded hover:bg-muted cursor-pointer"
                      title="Cancel"
                    >
                      <X size={14} weight="bold" className="text-muted-foreground" />
                    </span>
                  </div>
                </>
              ) : (
                // View mode
                <>
                  {/* Clickable area for filter toggle */}
                  <button
                    onClick={() => handleToggle(category.id)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    {/* Color dot */}
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="truncate">{category.name}</span>
                  </button>

                  {/* Hover actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <span
                      onClick={(e) => handleStartEdit(category.id, category.name, e)}
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
                </>
              )}
            </div>
          );
        })}
      </div>
    </SidebarSection>
  );
}