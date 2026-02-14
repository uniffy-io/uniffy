import { useState, useEffect, useCallback } from "react";
import {
  UserCircle,
  CheckCircle,
  PencilSimple,
  ChatCircle,
  Clock,
  ShieldWarning,
  PaperPlaneTilt,
  Trash,
  PencilLine,
} from "@phosphor-icons/react";
import { MarkdownEditor } from "@/components/editor";
import { formatDistanceToNow } from "date-fns";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { selectActivitiesForTask } from "../../store/projectsSlice";
import {
  fetchActivities,
  addCommentThunk,
  updateCommentThunk,
  deleteCommentThunk,
} from "../../store/projectsThunks";
import type { TaskActivity, ActivityAction } from "../../types/activity";

interface ActivityLogProps {
  taskId: string;
}

export function ActivityLog({ taskId }: ActivityLogProps) {
  const dispatch = useAppDispatch();
  const activities = useAppSelector(selectActivitiesForTask(taskId));
  const currentUserId = useAppSelector((state) => state.auth.userId);
  const [commentText, setCommentText] = useState("");
  const [commentEditorKey, setCommentEditorKey] = useState(0);
  const [commentEditorReady, setCommentEditorReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editEditorKey, setEditEditorKey] = useState(0);
  const [editEditorReady, setEditEditorReady] = useState(false);

  // Fetch activities from server on mount / taskId change
  useEffect(() => {
    dispatch(fetchActivities(taskId));
  }, [dispatch, taskId]);

  // Deferred mount for comment editor
  useEffect(() => {
    const timer = setTimeout(() => {
      setCommentEditorKey((prev) => prev + 1);
      setCommentEditorReady(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Deferred mount for edit editor
  useEffect(() => {
    if (!editingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting editor state when exiting edit mode
      setEditEditorReady(false);
      return;
    }
    const timer = setTimeout(() => {
      setEditEditorKey((prev) => prev + 1);
      setEditEditorReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [editingId]);

  const sorted = [...activities].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const handleSubmitComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (!trimmed) return;

    dispatch(addCommentThunk({ taskId, content: trimmed }));
    setCommentText("");
    // Remount editor to clear it
    setCommentEditorReady(false);
    setTimeout(() => {
      setCommentEditorKey((prev) => prev + 1);
      setCommentEditorReady(true);
    }, 50);
  }, [commentText, dispatch, taskId]);

  const handleDeleteComment = (activityId: string) => {
    dispatch(deleteCommentThunk({ taskId, activityId }));
  };

  const handleStartEdit = (activity: TaskActivity) => {
    setEditingId(activity.id);
    setEditText(activity.content ?? "");
  };

  const handleSaveEdit = useCallback(() => {
    if (editingId && editText.trim()) {
      dispatch(updateCommentThunk({ taskId, activityId: editingId, content: editText.trim() }));
    }
    setEditingId(null);
    setEditText("");
  }, [editingId, editText, dispatch, taskId]);

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Activity
      </h3>

      {/* Comment Input */}
      <div className="space-y-2">
        {commentEditorReady ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <MarkdownEditor
              key={commentEditorKey}
              value={commentText}
              onChange={setCommentText}
              placeholder="Add a comment... (type @ to mention)"
              minHeight="120px"
              maxHeight="200px"
              showBottomToolbar={true}
            />
          </div>
        ) : (
          <div className="min-h-30 border border-border rounded-lg bg-muted/30 animate-pulse" />
        )}
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            className="h-7"
            disabled={!commentText.trim()}
            onClick={handleSubmitComment}
          >
            <PaperPlaneTilt size={14} className="mr-1" />
            Comment
          </Button>
        </div>
      </div>

      {/* Activity List */}
      <div className="space-y-4 pl-2">
        {sorted.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No recent activity
          </div>
        ) : (
          sorted.map((activity) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              isOwnComment={activity.actorId === currentUserId && activity.action === "comment"}
              isEditing={editingId === activity.id}
              editText={editText}
              editEditorKey={editEditorKey}
              editEditorReady={editEditorReady}
              onEditTextChange={setEditText}
              onStartEdit={() => handleStartEdit(activity)}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => { setEditingId(null); setEditText(""); }}
              onDelete={() => handleDeleteComment(activity.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ActivityItemProps {
  activity: TaskActivity;
  isOwnComment: boolean;
  isEditing: boolean;
  editText: string;
  editEditorKey: number;
  editEditorReady: boolean;
  onEditTextChange: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function ActivityItem({
  activity,
  isOwnComment,
  isEditing,
  editText,
  editEditorKey,
  editEditorReady,
  onEditTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: ActivityItemProps) {
  const timeAgo = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true });

  return (
    <div className="flex gap-3 text-sm group">
      <div className="mt-0.5 text-muted-foreground">
        {renderActivityIcon(activity.action)}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">User {activity.actorId.split("-")[1]}</span>
          <span className="text-muted-foreground text-xs">{timeAgo}</span>
          {isOwnComment && !isEditing && (
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={onStartEdit}
                className="text-muted-foreground hover:text-foreground"
              >
                <PencilLine size={12} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash size={12} />
              </button>
            </div>
          )}
        </div>

        <div className="text-foreground">
          {activity.action === "comment" && isEditing ? (
            <div className="space-y-1">
              {editEditorReady ? (
                <div className="border border-border rounded-lg overflow-hidden">
                  <MarkdownEditor
                    key={editEditorKey}
                    value={editText}
                    onChange={onEditTextChange}
                    placeholder="Edit comment..."
                    minHeight="60px"
                    maxHeight="160px"
                    showBottomToolbar={true}
                  />
                </div>
              ) : (
                <div className="min-h-15 border border-border rounded-lg bg-muted/30 animate-pulse" />
              )}
              <div className="flex gap-1">
                <Button size="sm" className="h-6 text-xs" onClick={onSaveEdit}>Save</Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onCancelEdit}>Cancel</Button>
              </div>
            </div>
          ) : (
            renderActivityContent(activity)
          )}
        </div>
      </div>
    </div>
  );
}

function renderActivityIcon(action: ActivityAction) {
  switch (action) {
    case "created": return <UserCircle size={16} />;
    case "status_changed": return <CheckCircle size={16} />;
    case "priority_changed": return <ShieldWarning size={16} />;
    case "comment": return <ChatCircle size={16} />;
    case "field_updated": return <PencilSimple size={16} />;
    case "blocked_by_added":
    case "blocked_by_removed": return <Clock size={16} />;
    case "assigned": return <UserCircle size={16} />;
    default: return <PencilSimple size={16} />;
  }
}

function renderActivityContent(activity: TaskActivity) {
  switch (activity.action) {
    case "created":
      return "created this task";
    case "status_changed":
      return (
        <span>
          changed status from <span className="font-medium">{formatValue(activity.previousValue)}</span> to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    case "priority_changed":
      return (
        <span>
          changed to <span className="font-medium">{formatValue(activity.newValue)}</span> priority
        </span>
      );
    case "assigned":
      return <span>assigned to <span className="font-medium">{formatValue(activity.newValue)}</span></span>;
    case "comment":
      return (
        <div className="mt-1">
          <MarkdownEditor
            value={activity.content ?? ""}
            onChange={() => {}}
            readonly={true}
            minHeight="100px"
            className="border-none bg-transparent"
          />
        </div>
      );
    case "blocked_by_added":
      return <span>added dependency on <span className="font-medium">{formatValue(activity.newValue)}</span></span>;
    case "blocked_by_removed":
      return <span>removed dependency on <span className="font-medium">{formatValue(activity.previousValue)}</span></span>;
    case "field_updated":
      return (
        <span>
          updated {activity.fieldId} from <span className="font-medium">{formatValue(activity.previousValue)}</span> to <span className="font-medium">{formatValue(activity.newValue)}</span>
        </span>
      );
    default:
      return "updated the task";
  }
}

function formatValue(val: unknown): string {
  if (typeof val === "string") {
    if (val.startsWith("status_")) return val.replace("status_", "").replace("_", " ");
    if (val.startsWith("priority_")) return val.replace("priority_", "").replace("_", " ");
    if (val.startsWith("user-")) return `User ${val.split("-")[1]}`;
    if (val.startsWith("task-")) return `Task ${val.split("-")[1]}`;
    return val;
  }
  return String(val);
}
