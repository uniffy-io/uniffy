import { useLayoutEffect } from 'react';
import { useAuthNetworkCanvas } from '@/features/auth/hooks/useAuthNetworkCanvas';
import { UniffyLogo } from '@/components/ui/uniffy-logo';
import { defaultTheme } from '@/config/theme/types';

interface AuthShellProps {
    children: React.ReactNode;
}

function BrandContent() {
    return (
        <div className="h-full flex flex-col justify-between px-14 py-14">
            <div
                className="opacity-0"
                style={{ animation: 'auth-slide-up 0.6s ease-out 0.2s forwards' }}
            >
                <div className="flex items-center gap-4">
                    <UniffyLogo className="w-12 h-12" variant="dark" />
                    <span className="text-white text-3xl font-bold tracking-tight">uniffy</span>
                </div>
            </div>

            <div
                className="opacity-0"
                style={{ animation: 'auth-fade-in 0.8s ease-out 0.6s forwards' }}
            >
                <p className="text-white/50 text-sm font-medium tracking-widest uppercase leading-relaxed">
                    Work Infrastructure,<br />
                    finally unified.
                </p>
            </div>
        </div>
    );
}

export function AuthShell({ children }: AuthShellProps) {
    const canvasRef = useAuthNetworkCanvas();

    useLayoutEffect(() => {
        const root = document.documentElement;
        const wasDark = root.classList.contains('dark');
        root.classList.remove('dark');

        const savedValues: Record<string, string> = {};
        Object.entries(defaultTheme.colors).forEach(([key, value]) => {
            const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
            savedValues[cssVar] = root.style.getPropertyValue(cssVar);
            root.style.setProperty(cssVar, value);
        });

        return () => {
            if (wasDark) root.classList.add('dark');
            Object.entries(savedValues).forEach(([cssVar, value]) => {
                root.style.setProperty(cssVar, value);
            });
        };
    }, []);

    return (
        <>
            <style>{`
                @keyframes auth-slide-up {
                    from { opacity: 0; transform: translateY(16px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes auth-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes auth-spinner {
                    to { transform: rotate(360deg); }
                }
                .auth-btn {
                    background-color: #09090b;
                    color: white;
                }
                .auth-btn:hover:not(:disabled) {
                    background-color: #18181b;
                }
                .auth-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `}</style>

            <div className="flex min-h-screen relative overflow-hidden">
                <div
                    className="hidden lg:block absolute inset-y-0 left-0 w-[52%]"
                    style={{ background: 'linear-gradient(160deg, #09090b 0%, #171723 60%, #1a1a2e 100%)' }}
                />
                <div className="absolute inset-y-0 lg:left-[52%] left-0 right-0 bg-background" />

                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full z-[1] pointer-events-none hidden lg:block"
                />

                <div className="hidden lg:flex lg:w-[52%] relative z-[2] flex-col justify-start">
                    <BrandContent />
                </div>

                <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12 lg:px-20 relative z-[2]">
                    <div className="lg:hidden mb-10 flex items-center gap-3">
                        <UniffyLogo className="w-14 h-14" />
                        <span className="text-foreground text-xl font-bold tracking-tight">UNIFFY</span>
                    </div>

                    <div className="w-full max-w-sm">{children}</div>
                </div>
            </div>
        </>
    );
}
