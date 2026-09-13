import { useRef, useState } from "react";
import { CalendarPlus, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useAppDispatch } from "@/app/hooks";
import {
  applyCalendarImport,
  previewCalendarImport,
} from "@/features/calendar/store/calendarThunks";
import type {
  CalendarImportPreview,
  CalendarImportResult,
} from "@/features/calendar/types/interop";
import { formatDateShort } from "@/shared/utils/dateFormatting";

interface ImportCalendarModalProps {
  onClose: () => void;
  onImported?: () => void;
}

const ICS_ACCEPT = ".ics,text/calendar";

const plural = (count: number, singular: string, plural_: string) =>
  `${count} ${count === 1 ? singular : plural_}`;

/**
 * Import a .ics file in two steps: say what the file would do, then do it.
 *
 * The preview is not decoration - a file from another product routinely carries
 * entries we cannot represent, and finding that out after the import is worse
 * than before it.
 */
export function ImportCalendarModal({ onClose, onImported }: ImportCalendarModalProps) {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState<string | null>(null);
  const [content, setContent] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [result, setResult] = useState<CalendarImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setFilename(file.name);
    setContent(bytes);
    setPreview(null);
    setResult(null);
    setBusy(true);
    const outcome = await dispatch(previewCalendarImport({ content: bytes }));
    setBusy(false);
    if (previewCalendarImport.fulfilled.match(outcome)) setPreview(outcome.payload);
  };

  const handleImport = async () => {
    if (!content) return;
    setBusy(true);
    const outcome = await dispatch(applyCalendarImport({ content }));
    setBusy(false);
    if (applyCalendarImport.fulfilled.match(outcome)) {
      setResult(outcome.payload);
      onImported?.();
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <ModalHeader
        title="Import a calendar file"
        description="Add events from a .ics file exported by another calendar."
      />
      <ModalBody className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept={ICS_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            <UploadSimple size={16} weight="duotone" />
            {filename ? "Choose another file" : "Choose a file"}
          </Button>
          {filename && <span className="text-sm text-muted-foreground truncate">{filename}</span>}
        </div>

        {result ? (
          <ImportSummary result={result} />
        ) : (
          preview && <ImportPreview preview={preview} />
        )}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {result ? "Close" : "Cancel"}
        </Button>
        {!result && (
          <Button
            type="button"
            onClick={handleImport}
            disabled={busy || !preview || preview.creatable.length === 0}
          >
            <CalendarPlus size={16} weight="duotone" />
            {preview && preview.creatable.length > 0
              ? `Import ${plural(preview.creatable.length, "event", "events")}`
              : "Import"}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

function ImportPreview({ preview }: { preview: CalendarImportPreview }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {preview.creatable.length === 0
          ? "Nothing in this file is new to your calendar."
          : `${plural(preview.creatable.length, "event", "events")} will be added.`}
        {preview.duplicateCount > 0 &&
          ` ${preview.duplicateCount === 1 ? "1 is" : `${preview.duplicateCount} are`} already here and will be left alone.`}
      </p>

      {preview.creatable.length > 0 && (
        <ul className="space-y-1">
          {preview.creatable.map((entry, index) => (
            <li
              key={`${entry.title}-${entry.startTime}-${index}`}
              className="flex items-baseline justify-between gap-3 rounded-md bg-card px-3 py-2"
            >
              <span className="truncate text-sm">{entry.title}</span>
              <span className="shrink-0 text-xs text-subtle-foreground">
                {formatDateShort(entry.startTime)}
                {entry.isAllDay && " - all day"}
                {entry.repeats && " - repeats"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SkippedList entries={preview.skipped} />
    </div>
  );
}

function ImportSummary({ result }: { result: CalendarImportResult }) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Added {plural(result.createdCount, "event", "events")}.
        {result.duplicateCount > 0 &&
          ` ${result.duplicateCount === 1 ? "1 was" : `${result.duplicateCount} were`} already here.`}
      </p>
      <SkippedList entries={result.skipped} />
    </div>
  );
}

function SkippedList({ entries }: { entries: { label: string; reason: string }[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <WarningCircle size={16} weight="duotone" />
        {plural(entries.length, "entry", "entries")} could not be imported
      </p>
      <ul className="space-y-1">
        {entries.map((entry, index) => (
          <li key={`${entry.label}-${index}`} className="rounded-md bg-card px-3 py-2 text-xs">
            <span className="font-medium">{entry.label}</span>
            <span className="text-subtle-foreground"> - {entry.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
