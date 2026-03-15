import { Terminal } from "@phosphor-icons/react";

export function ConsoleView() {
    return (
        <div className="flex flex-col h-full items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Terminal size={32} className="text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mt-4">Console</h2>
            <p className="text-sm text-muted-foreground max-w-md mt-2 text-center">
                Debug console and method caller is under development.
            </p>
        </div>
    );
}
