import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/layout/brand";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-4 px-6">
      <BrandMark />
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">This address doesn&apos;t match any SURAKSHA screen.</p>
      <div className="flex gap-2">
        <Button asChild><Link href="/">Citizen home</Link></Button>
        <Button asChild variant="outline"><Link href="/dashboard">Operations dashboard</Link></Button>
      </div>
    </main>
  );
}
