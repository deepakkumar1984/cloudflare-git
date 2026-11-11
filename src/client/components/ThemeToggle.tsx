import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getTheme,
  toggleTheme,
  THEME_CHANGE_EVENT,
  type Theme,
} from "@/lib/theme";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getTheme());
    function onChange(event: Event) {
      setTheme((event as CustomEvent<Theme>).detail);
    }
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(toggleTheme())}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
