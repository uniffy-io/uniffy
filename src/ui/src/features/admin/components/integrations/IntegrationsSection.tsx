import { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
    ArrowClockwise,
    CheckCircle,
    CircleNotch,
    Plugs,
    Plus,
    ShieldCheck,
    Trash,
    XCircle,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { loadPanelLayout, savePanelLayout } from '@/shared/utils/panelStorage';
import { Button } from '@/components/ui/button';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
    selectIntegrationConnections,
    selectIntegrationProviders,
    selectIntegrationsStatus,
} from '@/features/integrations/store/integrationsSlice';
import {
    fetchConnections,
    fetchIntegrationProviders,
    removeConnection,
    toggleConnection,
    validateConnection,
} from '@/features/integrations/store/integrationsThunks';
import { integrationIcon } from '@/features/integrations/config/integrationBrands';
import { AddConnectionForm } from '@/features/admin/components/integrations/AddConnectionForm';
import { ConnectionDetailPanel } from '@/features/admin/components/integrations/ConnectionDetailPanel';

export function IntegrationsSection() {
    const dispatch = useAppDispatch();
    const providers = useAppSelector(selectIntegrationProviders);
    const connections = useAppSelector(selectIntegrationConnections);
    const status = useAppSelector(selectIntegrationsStatus);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [validatingId, setValidatingId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
    const [removing, setRemoving] = useState(false);

    useEffect(() => {
        dispatch(fetchIntegrationProviders());
        dispatch(fetchConnections());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const selectedConnection = useMemo(
        () => connections.find((c) => c.id === selectedId) ?? null,
        [connections, selectedId],
    );
    const SelectedBrandIcon = selectedConnection
        ? integrationIcon(selectedConnection.provider) ?? Plugs
        : Plugs;

    const handleValidate = async (connectionId: string) => {
        setValidatingId(connectionId);
        try {
            await dispatch(validateConnection(connectionId)).unwrap();
        } finally {
            setValidatingId(null);
        }
    };

    const handleToggle = async (connectionId: string, enabled: boolean) => {
        setTogglingId(connectionId);
        try {
            await dispatch(toggleConnection({ connectionId, enabled })).unwrap();
        } finally {
            setTogglingId(null);
        }
    };

    const handleRemoveConfirmed = async () => {
        if (!confirmingRemoveId) return;
        setRemoving(true);
        try {
            await dispatch(removeConnection(confirmingRemoveId)).unwrap();
            if (selectedId === confirmingRemoveId) {
                setSelectedId(null);
            }
            setConfirmingRemoveId(null);
        } finally {
            setRemoving(false);
        }
    };

    const handleConnectionAdded = (connectionId: string) => {
        setShowAddForm(false);
        setSelectedId(connectionId);
    };

    const [defaultLayout] = useState(() => loadPanelLayout('admin-integrations'));

    const handleLayoutChange = useCallback((layout: Record<string, number>) => {
        savePanelLayout('admin-integrations', layout);
    }, []);

    return (
        <div className="flex flex-col gap-6 w-full">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Plugs size={22} weight="duotone" className="text-primary" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Org-wide connections to external services. Agents use them through the
                        tools their builder enables.
                    </p>
                </div>
            </div>

            <div className="h-[70vh] min-h-[480px] rounded-xl border border-border overflow-hidden bg-background">
                {status === 'loading' && connections.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <CircleNotch size={32} className="animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <Group
                        orientation="horizontal"
                        className="h-full w-full flex"
                        defaultLayout={defaultLayout}
                        onLayoutChange={handleLayoutChange}
                    >
                        <Panel
                            id="integrations-sidebar"
                            defaultSize={260}
                            minSize={200}
                            maxSize={400}
                            className="border-r border-border bg-card overflow-hidden"
                        >
                            <div className="h-full flex flex-col">
                                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                                    <span className="font-semibold text-foreground">Connections</span>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => dispatch(fetchConnections({ force: true }))}
                                        >
                                            <ArrowClockwise size={16} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={showAddForm ? 'text-primary bg-primary/10' : ''}
                                            onClick={() => setShowAddForm(!showAddForm)}
                                        >
                                            <Plus size={16} />
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto">
                                    {connections.map((connection) => {
                                        const isSelected = connection.id === selectedId;
                                        const BrandIcon = integrationIcon(connection.provider) ?? Plugs;
                                        return (
                                            <button
                                                key={connection.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedId(connection.id);
                                                    setShowAddForm(false);
                                                }}
                                                className={cn(
                                                    'w-full px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors text-left',
                                                    isSelected
                                                        ? 'bg-primary/10 border-l-2 border-primary'
                                                        : 'hover:bg-muted border-l-2 border-transparent',
                                                )}
                                            >
                                                <BrandIcon size={18} className="text-muted-foreground shrink-0" />
                                                <div className="flex flex-col flex-1 min-w-0">
                                                    <span className="text-sm font-medium truncate text-foreground">
                                                        {connection.name}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground capitalize truncate">
                                                        {connection.provider} - {connection.credentialHint || '***'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {!connection.isEnabled ? (
                                                        <XCircle size={14} className="text-muted-foreground" />
                                                    ) : connection.isValid ? (
                                                        <CheckCircle size={14} weight="fill" className="text-green-600 dark:text-green-400" />
                                                    ) : (
                                                        <XCircle size={14} weight="fill" className="text-muted-foreground" />
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </Panel>

                        <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />

                        <Panel id="integrations-detail" minSize={400}>
                            <div className="h-full flex flex-col overflow-hidden">
                                {showAddForm ? (
                                    <>
                                        <div className="px-6 py-4 border-b border-border">
                                            <h2 className="text-xl font-semibold text-foreground">
                                                Add Connection
                                            </h2>
                                            <p className="text-sm text-muted-foreground">
                                                Connect an external service for agents to use
                                            </p>
                                        </div>
                                        <div className="flex-1 overflow-y-auto p-6">
                                            <div className="max-w-xl">
                                                <AddConnectionForm
                                                    providers={providers}
                                                    onSubmit={handleConnectionAdded}
                                                />
                                            </div>
                                        </div>
                                    </>
                                ) : selectedConnection ? (
                                    <>
                                        <div className="px-6 py-4 border-b border-border">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                                    <SelectedBrandIcon size={20} className="text-muted-foreground" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h2 className="text-xl font-semibold text-foreground">
                                                        {selectedConnection.name}
                                                    </h2>
                                                    <p className="text-sm text-muted-foreground capitalize truncate">
                                                        {selectedConnection.provider} - {selectedConnection.credentialHint || '***'}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="mr-2">
                                                        <ToggleSwitch
                                                            enabled={selectedConnection.isEnabled}
                                                            disabled={togglingId === selectedConnection.id}
                                                            onChange={(enabled) => handleToggle(selectedConnection.id, enabled)}
                                                        />
                                                    </span>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleValidate(selectedConnection.id)}
                                                        disabled={validatingId === selectedConnection.id}
                                                        aria-label="Validate connection"
                                                        title="Validate"
                                                    >
                                                        {validatingId === selectedConnection.id ? (
                                                            <CircleNotch size={18} className="animate-spin" />
                                                        ) : (
                                                            <ShieldCheck size={18} />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setConfirmingRemoveId(selectedConnection.id)}
                                                        aria-label="Remove connection"
                                                        title="Remove"
                                                        className="text-muted-foreground hover:text-red-500"
                                                    >
                                                        <Trash size={18} />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                            <ConnectionDetailPanel connection={selectedConnection} />
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex-1 flex items-center justify-center">
                                        <div className="text-center">
                                            <Plugs size={32} className="text-muted-foreground mx-auto mb-2" />
                                            <p className="text-muted-foreground">
                                                {connections.length > 0
                                                    ? 'Select a connection from the sidebar'
                                                    : 'No connections configured'}
                                            </p>
                                            {connections.length === 0 && (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="mt-3"
                                                    onClick={() => setShowAddForm(true)}
                                                >
                                                    <Plus size={14} />
                                                    Add Connection
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Panel>
                    </Group>
                )}
            </div>

            <ConfirmDialog
                isOpen={confirmingRemoveId !== null}
                onClose={() => (removing ? undefined : setConfirmingRemoveId(null))}
                onConfirm={handleRemoveConfirmed}
                title="Remove connection?"
                loading={removing}
                message="Agents lose access to the tools that use this connection. The stored credential is deleted and cannot be recovered."
                confirmLabel="Remove"
            />
        </div>
    );
}
