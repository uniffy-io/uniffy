import { useState, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { X, Plus } from '@phosphor-icons/react';

interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  maxTags?: number;
  disabled?: boolean;
}

/**
 * Tag Input component for managing note tags.
 * Supports adding tags via Enter key or comma, and removing via click or backspace.
 */
export function TagInput({ tags, onTagsChange, maxTags = 10, disabled = false }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizeTag = (tag: string): string => {
    // Remove # if present, lowercase, trim, replace spaces with hyphens
    return tag
      .replace(/^#/, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  };

  const addTag = (rawTag: string) => {
    const tag = normalizeTag(rawTag);
    if (tag && !tags.includes(tag) && tags.length < maxTags) {
      onTagsChange([...tags, tag]);
    }
    setInputValue('');
  };

  const removeTag = (tagToRemove: string) => {
    onTagsChange(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      // Remove last tag on backspace when input is empty
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
    }
  };

  const handleBlur = () => {
    // Add any pending input as a tag
    if (inputValue.trim()) {
      addTag(inputValue);
    }
    setIsEditing(false);
  };

  const startEditing = () => {
    setIsEditing(true);
    // Focus input after state update
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Existing Tags */}
      {tags.map((tag) => (
        <span
          key={tag}
          className={`group inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-primary/10 text-primary ${
            disabled ? '' : 'hover:bg-primary/20'
          } transition-colors`}
        >
          #{tag}
          {!disabled && (
            <button
              onClick={() => removeTag(tag)}
              className="opacity-0 group-hover:opacity-100 -mr-1 p-0.5 rounded-full hover:bg-primary/20 transition-opacity"
              title="Remove tag"
            >
              <X size={12} weight="bold" />
            </button>
          )}
        </span>
      ))}

      {/* Add Tag Input/Button - only show when not disabled */}
      {!disabled && (
        <>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder="Add tag..."
              className="w-24 px-2 py-1 text-xs bg-transparent border-0 ring-1 ring-primary/40 focus:ring-primary rounded-full outline-none text-foreground placeholder:text-muted-foreground"
              maxLength={32}
            />
          ) : (
            tags.length < maxTags && (
              <button
                onClick={startEditing}
                className="p-1 rounded-full hover:bg-muted transition-colors"
                title="Add tag"
              >
                <Plus size={16} weight="bold" className="text-muted-foreground" />
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}
