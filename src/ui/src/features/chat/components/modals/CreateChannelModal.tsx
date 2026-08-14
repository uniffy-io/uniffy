import { useState, useEffect, useRef, useCallback } from "react";
import { X, GlobeSimple, Lock, Check } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/shared/utils/cn";
import { closeCreateChannelModal } from "@/features/chat/store/chatUiSlice";
import { createChannel } from "@/features/chat/store/chatThunks";
import { selectCategories } from "@/features/chat/store/chatChannelsSlice";
import { ChannelType } from "@uniffy/proto/chat/v1/chat_pb";

export function CreateChannelModal() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const categories = useAppSelector(selectCategories);
  const defaultCategoryId = useAppSelector((state) => state.chatUi.createChannelCategoryId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelType, setChannelType] = useState<"public" | "private">("public");
  const [categoryId, setCategoryId] = useState<string | undefined>(defaultCategoryId ?? undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_NAME_LENGTH = 50;
  const isNameValid = name.trim().length > 0;
  const showError = touched && !isNameValid;

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = useCallback(() => {
    setName("");
    setDescription("");
    setChannelType("public");
    setCategoryId(undefined);
    setTouched(false);
    dispatch(closeCreateChannelModal());
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isNameValid) return;

    setIsSubmitting(true);
    try {
      const result = await dispatch(
        createChannel({
          name: name.trim(),
          channelType: channelType === "public" ? ChannelType.PUBLIC : ChannelType.PRIVATE,
          description: description.trim() || undefined,
          categoryId: categoryId || undefined,
        }),
      ).unwrap();

      navigate(`/chat/${result.id}`);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const categoryOptions = [
    { value: "", label: "No category" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <Modal onClose={handleClose} closeDisabled={isSubmitting}>
      <div data-testid="chat-create-channel-modal">
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-semibold text-foreground">Create a new channel</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            data-testid="chat-create-channel-close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Channel name
              </label>
              <Input
                ref={inputRef}
                type="text"
                placeholder="Enter a name for your new channel"
                value={name}
                onChange={(e) => {
                  setName(e.target.value.slice(0, MAX_NAME_LENGTH));
                  if (!touched) setTouched(true);
                }}
                disabled={isSubmitting}
                className={cn(showError && "border-red-500 focus-visible:ring-red-500")}
                data-testid="chat-create-channel-name-input"
              />
              <div className="flex items-center justify-between mt-1">
                {showError ? (
                  <p className="text-xs text-red-500">
                    Channel names must have at least 1 character.
                  </p>
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

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setChannelType("public")}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg border p-3.5 text-left transition-colors",
                  channelType === "public"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-muted-foreground/30",
                )}
                data-testid="chat-create-channel-type-public"
                data-selected={channelType === "public" ? "true" : "false"}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    channelType === "public"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <GlobeSimple size={22} weight="bold" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Public Channel</p>
                  <p className="text-xs text-muted-foreground">Anyone can join</p>
                </div>
                {channelType === "public" && (
                  <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check size={12} weight="bold" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => setChannelType("private")}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg border p-3.5 text-left transition-colors",
                  channelType === "private"
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:border-muted-foreground/30",
                )}
                data-testid="chat-create-channel-type-private"
                data-selected={channelType === "private" ? "true" : "false"}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    channelType === "private"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Lock size={22} weight="bold" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Private Channel</p>
                  <p className="text-xs text-muted-foreground">Only invited members</p>
                </div>
                {channelType === "private" && (
                  <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check size={12} weight="bold" />
                  </div>
                )}
              </button>
            </div>

            {categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Category
                  <span className="text-muted-foreground font-normal ml-1">(optional)</span>
                </label>
                <Select
                  value={categoryId ?? ""}
                  onChange={(v) => setCategoryId(v || undefined)}
                  options={categoryOptions}
                  size="md"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Channel Purpose
                <span className="text-muted-foreground font-normal ml-1">(optional)</span>
              </label>
              <textarea
                placeholder="What is this channel about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                data-testid="chat-create-channel-description-input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                This will be displayed when browsing for channels.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
              data-testid="chat-create-channel-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isNameValid || isSubmitting}
              loading={isSubmitting}
              data-testid="chat-create-channel-submit"
            >
              Create channel
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
