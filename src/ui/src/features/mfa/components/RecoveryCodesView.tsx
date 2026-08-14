import { Copy, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

interface RecoveryCodesViewProps {
  codes: string[];
}

/** Server hashes codes on commit, so this render is the only chance to save them. */
export function RecoveryCodesView({ codes }: RecoveryCodesViewProps) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Recovery codes copied to clipboard.");
  };

  const handleDownload = () => {
    const header =
      "Uniffy recovery codes\n" +
      "Save these somewhere only you can reach. Each code works once.\n\n";
    const blob = new Blob([header + codes.join("\n") + "\n"], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "uniffy-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <div
            key={code}
            className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm tracking-wider text-foreground"
          >
            {code}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <Copy size={16} /> Copy
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
        >
          <DownloadSimple size={16} /> Download
        </button>
      </div>
    </div>
  );
}
