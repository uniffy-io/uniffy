import { SquaresFour } from "@phosphor-icons/react";

export function OverviewView() {
    return (
        <div className="flex flex-col h-full items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                <SquaresFour size={32} className="text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mt-4">Overview</h2>
            <p className="text-sm text-muted-foreground max-w-md mt-2 text-center">
                Dashboard overview and system health monitoring is under development.
            </p>
        </div>
    );
}
