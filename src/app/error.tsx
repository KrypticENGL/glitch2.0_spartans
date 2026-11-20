"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/layout/brand";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <BrandMark />
      <h1 className="text-2xl font-bold">This screen failed to load</h1>
      <p className="text-muted-foreground">
        Something went wrong while showing this page. Your demo data is still saved in this browser. Try again, or go back to the home screen.
      </p>
      <p className="text-sm">In a real emergency in India, call <b>112</b>.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline"><Link href="/">Go to home</Link></Button>
      </div>
    </main>
  );
}
