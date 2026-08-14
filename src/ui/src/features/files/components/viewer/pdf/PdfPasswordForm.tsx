import { useState } from "react";
import { LockSimple } from "@phosphor-icons/react";

interface PdfPasswordFormProps {
  /** True after a wrong password; shows the retry message. */
  incorrect: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PdfPasswordForm({ incorrect, onSubmit, onCancel }: PdfPasswordFormProps) {
  const [password, setPassword] = useState("");

  return (
    <div className="viewer-error">
      <LockSimple size={40} className="viewer-unsupported-icon" />
      <p className="viewer-unsupported-title">This document is password protected</p>
      {incorrect && <p className="viewer-pdf-password-error">Wrong password, try again</p>}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (password) onSubmit(password);
        }}
      >
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="viewer-pdf-password-input"
          aria-label="Document password"
        />
        <button type="submit" disabled={!password} className="viewer-btn-primary px-4 py-2 text-sm">
          Unlock
        </button>
        <button type="button" onClick={onCancel} className="viewer-btn px-4 py-2 text-sm">
          Cancel
        </button>
      </form>
    </div>
  );
}
