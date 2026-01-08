import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../ui/button';

export function ThemeToggle() {
  const { theme, setTheme, availableThemes } = useTheme();

  const toggleTheme = () => {
    const nextTheme = availableThemes.find(t => t.name !== theme.name) || availableThemes[0];
    setTheme(nextTheme);
  };

  return (
    <Button 
      variant="ghost" 
      size="sm" 
      onClick={toggleTheme}
      className="w-9 px-0"
      title={`Switch to ${theme.name === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme.name === 'dark' ? (
        // Sun icon
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        // Moon icon
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
