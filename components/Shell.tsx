"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartBar, Gavel, Grid3x3, Landmark, LogOut, Menu, Radio, ScrollText, UserRound, Users, X } from "lucide-react";
import { cn, initialsOf } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ThemeToggle } from "./ThemeToggle";
import { Mark } from "./Mark";
import type { StaffUser } from "@/lib/auth";

const SECTIONS = [
  {
    title: "District court · Saket",
    items: [
      { href: "/district", label: "Cases", icon: Landmark, exact: true },
      { href: "/district/advocates", label: "Advocates", icon: Users },
      { href: "/district/case-types", label: "Case types", icon: ChartBar },
    ],
  },
  {
    title: "High Court of Delhi",
    items: [
      { href: "/high-court", label: "Judgments", icon: ScrollText, exact: true },
      { href: "/high-court/judges", label: "Judges", icon: UserRound },
      { href: "/high-court/case-types", label: "Case types & judges", icon: Grid3x3 },
    ],
  },
  {
    title: "Capture",
    items: [{ href: "/capture", label: "Runs & extension", icon: Radio }],
  },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href || (pathname.startsWith(`${href}/`) && !SECTIONS.flatMap((s) => s.items).some((i) => i.href !== href && pathname.startsWith(i.href)));
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ user, children }: { user: StaffUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const nav = (
    <nav className="space-y-5">
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="cc-label mb-1.5 px-2.5">{s.title}</div>
          <div className="flex flex-col gap-0.5">
            {s.items.map((item) => {
              const on = isActive(pathname, item.href, item.exact);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} data-active={on} className="cc-nav-item group">
                  {on && <span className="absolute left-0 top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-full bg-accent" />}
                  <Icon className={cn("h-[15px] w-[15px] shrink-0", on ? "text-accent" : "text-faint group-hover:text-dim")} />
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/district" className="flex items-center gap-2.5 px-1">
      <Mark />
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Court Capture</span>
        <span className="mt-1 text-[10.5px] text-faint">Records, advocates, orders</span>
      </span>
    </Link>
  );

  const footer = (
    <div className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-raised/60 p-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accentSoft">
        {initialsOf(user.name ?? user.email)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-dim">{user.name ?? user.email}</span>
      <button onClick={signOut} title="Sign out" className="rounded p-1 text-faint hover:text-foreground">
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-hairline bg-panel/80 px-3 py-4 backdrop-blur-2xl lg:flex">
        <div className="mb-7">{brand}</div>
        {nav}
        <div className="mt-auto">{footer}</div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-scrim" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-hairline bg-panel px-3 py-4">
            <div className="mb-7 flex items-center justify-between">
              {brand}
              <button onClick={() => setDrawer(false)} className="rounded p-1 text-faint" aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            <div className="mt-auto">{footer}</div>
          </aside>
        </div>
      )}

      <div className="lg:pl-[232px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-canvas/75 px-4 backdrop-blur-2xl md:px-7">
          <button onClick={() => setDrawer(true)} className="rounded p-1.5 text-dim lg:hidden" aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </button>
          <span className="flex items-center gap-2 text-[12.5px] text-faint lg:hidden">
            <Gavel className="h-3.5 w-3.5 text-accent" /> Court Capture
          </span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="px-4 py-7 md:px-7 md:py-9">{children}</main>
      </div>
    </>
  );
}
