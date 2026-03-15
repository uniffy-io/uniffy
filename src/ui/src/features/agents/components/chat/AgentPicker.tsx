/**
 * AgentPicker - Dropdown for selecting an agent when starting a new conversation.
 *
 * Uses a fixed-position menu (same pattern as notes CreateDropdown).
 * Shows all available agents with avatar emoji, name, and model badge.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { selectAllAgents } from "@/features/agents/store/agentsSlice";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";

interface AgentPickerProps {
    onSelectAgent: (agent: SerializedAgent) => void;
    disabled?: boolean;
}

export function AgentPicker({ onSelectAgent, disabled = false }: AgentPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const agentsMap = useAppSelector(selectAllAgents);
    const agents = Object.values(agentsMap);

    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsOpen(false);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen]);

    const handleToggle = useCallback(() => {
        if (disabled) return;

        if (!isOpen) {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) {
                const menuWidth = 240;
                const menuHeight = Math.min(agents.length * 48 + 8, 300);
                const x = rect.left;
                const y = rect.bottom + menuHeight > window.innerHeight
                    ? rect.top - menuHeight
                    : rect.bottom + 4;
                const adjustedX = x + menuWidth > window.innerWidth
                    ? window.innerWidth - menuWidth - 8
                    : x;
                setMenuPos({ x: adjustedX, y });
            }
        }
        setIsOpen((prev) => !prev);
    }, [disabled, isOpen, agents.length]);

    const handleSelect = useCallback(
        (agent: SerializedAgent) => {
            setIsOpen(false);
            onSelectAgent(agent);
        },
        [onSelectAgent],
    );

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={handleToggle}
                disabled={disabled}
                className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 text-sm font-medium",
                    "rounded-lg border border-border bg-card hover:bg-muted",
                    "transition-colors disabled:opacity-50",
                )}
            >
                <Plus size={16} weight="bold" className="text-primary" />
                <span className="text-foreground">New Chat</span>
            </button>

            {isOpen && (
                <div
                    ref={menuRef}
                    className="fixed z-50 w-60 overflow-hidden rounded-md border border-border bg-card shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
                    style={{ top: menuPos.y, left: menuPos.x }}
                >
                    <div className="px-3 py-2 border-b border-border">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Select Agent
                        </span>
                    </div>
                    <div className="py-1 max-h-64 overflow-y-auto">
                        {agents.length === 0 && (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                                No agents available
                            </div>
                        )}
                        {agents.map((agent) => (
                            <button
                                key={agent.id}
                                type="button"
                                onClick={() => handleSelect(agent)}
                                className="flex items-center gap-3 w-full px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                            >
                                <AgentAvatar
                                    avatarKey={agent.avatarKey}
                                    avatarEmoji={agent.avatarEmoji}
                                    agentName={agent.name}
                                    size="sm"
                                />
                                <span className="flex-1 text-left truncate">{agent.name}</span>
                                {agent.isDefault && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        Default
                                    </Badge>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
