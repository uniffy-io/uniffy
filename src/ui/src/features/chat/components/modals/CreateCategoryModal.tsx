import { useState, useEffect, useRef, useCallback } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/shared/utils/cn";
import { closeCreateCategoryModal } from "@/features/chat/store/chatUiSlice";
import { createCategoryThunk } from "@/features/chat/store/chatThunks";

const MAX_NAME_LENGTH = 40;

export function CreateCategoryModal() {
  const dispatch = useAppDispatch();

  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isNameValid = name.trim().length > 0;
  const showError = touched && !isNameValid;

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setName("");
    setTouched(false);
    dispatch(closeCreateCategoryModal());
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isNameValid) return;

    setIsSubmitting(true);
    try {
      await dispatch(createCategoryThunk(name.trim())).unwrap();
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting} maxWidth="max-w-md">
      <div data-testid="chat-create-category-modal">
        <ModalHeader title="New category" />

        <form onSubmit={handleSubmit}>
          <ModalBody>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Category name</label>
              <Input
                ref={inputRef}
                type="text"
                placeholder="e.g. Engineering, Marketing, Design"
                value={name}
                onChange={(e) => {
                  setName(e.target.value.slice(0, MAX_NAME_LENGTH));
                  if (!touched) setTouched(true);
                }}
                disabled={isSubmitting}
                className={cn(showError && "border-red-500")}
                data-testid="chat-create-category-name-input"
              />
              <div className="flex items-center justify-between mt-1">
                {showError ? (
                  <p className="text-xs text-red-500">Category name is required.</p>
                ) : (
                  <span />
                )}
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    name.length >= MAX_NAME_LENGTH ? "text-red-500" : "text-muted-foreground",
                  )}
                >
                  {name.length}/{MAX_NAME_LENGTH}
                </p>
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
              data-testid="chat-create-category-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isNameValid || isSubmitting}
              loading={isSubmitting}
              data-testid="chat-create-category-submit"
            >
              Create category
            </Button>
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
}
