import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { Mark } from "@/components/Mark";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden border-r border-hairline bg-panel lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[14px] font-semibold tracking-tight">Court Capture</span>
        </div>
        <div className="max-w-[28rem]">
          <div className="cc-label mb-5">District Court · High Court of Delhi</div>
          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.028em] text-foreground">
            Every order, every advocate,
            <br />
            one place.
          </h1>
          <p className="mt-5 text-[14.5px] leading-relaxed text-dim">
            Cases from Saket and judgments from the Delhi High Court, read straight from the courts&apos; own sites — with the hearing history,
            the advocates on each side, and a summary of any order in one click.
          </p>
        </div>
        <div className="flex gap-10">
          {[
            ["Captured", "by the browser extension"],
            ["Summarised", "once, then kept"],
            ["Shared", "work across the team"],
          ].map(([a, b]) => (
            <div key={a}>
              <div className="text-[13px] font-medium text-foreground">{a}</div>
              <div className="text-[11.5px] text-faint">{b}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 lg:hidden">
            <Mark />
          </div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Sign in</h2>
          <p className="mt-1.5 text-[13px] text-dim">Use your team account.</p>
          <Suspense fallback={<div className="mt-7 h-40" />}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
