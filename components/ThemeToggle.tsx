"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light" | "system";

const KEY = "cc-theme";

/**
 * Writes data-theme onto the .cc-root wrapper. The choice is stored per
 * browser, not per user: it is a viewing preference, not account data.
 */
function apply(theme: Theme) {
  const root = document.querySelector(".cc-root");
  if (!root) return;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
  root.setAttribute("data-theme", resolved);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (window.localStorage.getItem(KEY) as Theme | null) ?? "system";
    setTheme(stored);
    apply(stored);

    // Only follow the OS while the user is actually on "system".
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if ((window.localStorage.getItem(KEY) as Theme | null) === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    window.localStorage.setItem(KEY, next);
    apply(next);
  };

  const options: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "Match system" },
  ];

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex items-center rounded-[8px] border border-hairline bg-sunken p-0.5"
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => choose(value)}
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          className={cn(
            "rounded-[6px] p-1.5 transition-colors",
            theme === value ? "bg-tint3 text-foreground" : "text-faint hover:text-dim"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

/**
 * Applied before React hydrates so a light-theme user does not get a dark
 * flash on every navigation. Kept tiny and dependency-free on purpose.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var r=document.querySelector('.cc-root');if(!r)return;var d=t==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;r.setAttribute('data-theme',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
