import { useState, type ReactNode } from 'react';
import { CaretDown, CheckCircle, CircleNotch, Stop, XCircle } from '@phosphor-icons/react';
import { formatMediaTime } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';

export type ToolStepStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface ToolStep {
    id: string;
    toolName: string;
    /** Past/neutral action label, e.g. "Create note". */
    label: string;
    /** Present-tense label shown while running, e.g. "Creating note". Falls back to label. */
    runningLabel?: string;
    args?: string;
    result?: string;
    status: ToolStepStatus;
    durationSecs?: number;
    /** Extra hint shown under a running step, e.g. slow-operation notice. */
    hint?: string;
}

interface ToolActivityPaneProps {
    steps: readonly ToolStep[];
    /** True while any step is still running. */
    live: boolean;
    /** True once the answer has started; auto-collapses the pane. */
    answerStarted: boolean;
    /** Renders the tool result body; defaults to a monospace block. */
    renderResult?: (result: string) => ReactNode;
    onStop?: () => void;
    testId?: string;
}

/**
 * Collapsible tool-activity pane sharing the reasoning pane's visual language.
 *
 * Header mirrors ThinkingPane: a live "Using ..." spinner state that settles to
 * "Ran N actions"; the body is a status timeline of tool steps that each expand
 * to their arguments and result.
 */
export function ToolActivityPane({
    steps,
    live,
    answerStarted,
    renderResult,
    onStop,
    testId,
}: ToolActivityPaneProps) {
    const [userToggle, setUserToggle] = useState<boolean | null>(null);

    if (steps.length === 0) return null;

    const expanded = userToggle ?? !answerStarted;
    const active = steps.find((s) => s.status === 'running');
    const headerLabel = live
        ? active
            ? `${active.runningLabel ?? active.label}...`
            : 'Working...'
        : steps.length === 1
            ? steps[0].label
            : `Ran ${steps.length} actions`;

    return (
        <div className="flex flex-col items-start w-full max-w-[70%]" data-testid={testId ?? 'tool-activity-pane'}>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setUserToggle(!expanded)}
                    className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
                    data-state={expanded ? 'open' : 'closed'}
                    data-tool-live={live ? 'true' : 'false'}
                >
                    {live ? (
                        <>
                            <CircleNotch size={13} className="animate-spin" />
                            <span className="animate-pulse">{headerLabel}</span>
                        </>
                    ) : (
                        <span>{headerLabel}</span>
                    )}
                    {steps.length > 1 && (
                        <span className="text-[11px] tabular-nums text-muted-foreground/70">{steps.length}</span>
                    )}
                    <CaretDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
                </button>
                {live && onStop && (
                    <button
                        type="button"
                        onClick={onStop}
                        className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-red-500 hover:border-red-500/40 transition-colors"
                        title="Stop the agent"
                    >
                        <Stop size={11} weight="fill" />
                        Stop
                    </button>
                )}
            </div>
            {expanded && (
                <div className="mt-1 mb-1 w-full">
                    {steps.map((step, idx) => (
                        <ToolStepRow
                            key={step.id}
                            step={step}
                            last={idx === steps.length - 1}
                            // The header already names a lone action, so its row shows
                            // timing instead of repeating the name.
                            showLabel={steps.length > 1}
                            renderResult={renderResult}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function StatusIcon({ status }: { status: ToolStepStatus }) {
    switch (status) {
        case 'running':
            return <CircleNotch size={14} className="animate-spin text-muted-foreground shrink-0" />;
        case 'failed':
            return <XCircle size={14} weight="fill" className="text-red-500 shrink-0" />;
        case 'interrupted':
            return <Stop size={14} weight="fill" className="text-muted-foreground/70 shrink-0" />;
        default:
            return <CheckCircle size={14} weight="fill" className="text-green-500 shrink-0" />;
    }
}

function ToolStepRow({
    step,
    last,
    showLabel,
    renderResult,
}: {
    step: ToolStep;
    last: boolean;
    showLabel: boolean;
    renderResult?: (result: string) => ReactNode;
}) {
    const [showArgs, setShowArgs] = useState(false);
    const [showResult, setShowResult] = useState(false);

    const hasArgs = !!step.args && step.args !== '{}' && step.args !== 'None';
    const hasResult = !!step.result && step.result.trim().length > 0;
    const hasDuration = step.durationSecs !== undefined && step.durationSecs > 0;
    const labelText =
        step.status === 'running'
            ? `${step.runningLabel ?? step.label}...`
            : step.status === 'interrupted'
                ? `${step.label} interrupted`
                : step.status === 'failed'
                    ? `${step.label} failed`
                    : step.label;
    // A lone step's name lives in the pane header, so the row leads with timing.
    const timingText =
        step.status === 'running'
            ? 'Running...'
            : step.status === 'interrupted'
                ? 'Interrupted'
                : step.status === 'failed'
                    ? 'Failed'
                    : hasDuration
                        ? `Took ${formatMediaTime(step.durationSecs!)}`
                        : 'Completed';
    const headline = showLabel ? labelText : timingText;

    return (
        <div className="flex gap-2.5" data-tool-name={step.toolName} data-tool-status={step.status}>
            <div className="flex flex-col items-center pt-1">
                <StatusIcon status={step.status} />
                {!last && <div className="w-px flex-1 bg-border mt-1" />}
            </div>
            <div className="text-[13px] leading-relaxed text-muted-foreground break-words pb-3 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-foreground">{headline}</span>
                    {showLabel && hasDuration && (
                        <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                            {formatMediaTime(step.durationSecs!)}
                        </span>
                    )}
                </div>
                {step.status === 'running' && step.hint && (
                    <div className="mt-1 text-[11px] text-muted-foreground/80">{step.hint}</div>
                )}
                {(hasArgs || hasResult) && (
                    <div className="flex items-center gap-3 mt-1">
                        {hasArgs && (
                            <button
                                type="button"
                                onClick={() => setShowArgs((v) => !v)}
                                className="text-[11px] text-muted-foreground/80 hover:text-foreground"
                                data-state={showArgs ? 'open' : 'closed'}
                            >
                                {showArgs ? 'Hide arguments' : 'Show arguments'}
                            </button>
                        )}
                        {hasResult && (
                            <button
                                type="button"
                                onClick={() => setShowResult((v) => !v)}
                                className="text-[11px] text-muted-foreground/80 hover:text-foreground"
                                data-state={showResult ? 'open' : 'closed'}
                            >
                                {showResult ? 'Hide result' : 'Show result'}
                            </button>
                        )}
                    </div>
                )}
                {showArgs && hasArgs && (
                    <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 mt-1 overflow-x-auto text-foreground/80">
                        {step.args}
                    </pre>
                )}
                {showResult && hasResult && (
                    <div className="mt-1">
                        {renderResult ? (
                            renderResult(step.result!)
                        ) : (
                            <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap text-foreground/80 max-h-64">
                                {step.result}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
