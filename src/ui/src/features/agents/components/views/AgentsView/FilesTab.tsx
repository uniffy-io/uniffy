import { File } from "@phosphor-icons/react";

export function FilesTab() {
    return (
        <div className="bg-muted/30 border border-dashed border-border rounded-lg p-12 text-center">
            <File size={40} className="text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-foreground">Knowledge Base</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                Coming soon -- attach files as knowledge sources for this agent.
                Uploaded documents will provide additional context for conversations.
            </p>
        </div>
    );
}
