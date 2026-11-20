"use client";

import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status";
import { api, type PushConfig } from "@/features/notifications/api";
import { useAlerts } from "@/features/notifications/alerts-store";
import { disablePush, enablePush, pushSupport, readStored, reconcilePush, updatePrefs, type PushSupport, type StoredSubscription } from "@/features/notifications/push";

type MinSeverity = StoredSubscription["minSeverity"];

const noopSubscribe = () => () => undefined;

export function PushOptIn() {
  // Browser capabilities and the saved subscription only exist on the client, so render after mount.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return mounted ? <PushOptInPanel /> : <section id="notifications" className="h-64 rounded-lg border bg-card" aria-busy="true" />;
}

function PushOptInPanel() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [support] = useState<PushSupport>(pushSupport);
  const [permission, setPermission] = useState<NotificationPermission | "n/a">(() => ("Notification" in window ? Notification.permission : "n/a"));
  const [stored, setStored] = useState<StoredSubscription | null>(readStored);
  const [minSeverity, setMinSeverity] = useState<MinSeverity>(() => readStored()?.minSeverity ?? "advisory");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const areas = useAlerts((s) => s.areas);
  const setAreas = useAlerts((s) => s.setAreas);

  useEffect(() => {
    const local = readStored();
    if (local) setAreas(local.areas);
    api<PushConfig>("/push/config")
      .then(async (c) => {
        setConfig(c);
        if (support === "supported") setStored(await reconcilePush(c).catch(() => local)); // renews a dropped subscription silently
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [setAreas, support]);

  const toggleArea = (code: string, on: boolean) => setAreas(on ? [...areas, code] : areas.filter((a) => a !== code));

  async function enable() {
    if (!config || areas.length === 0) return;
    setBusy(true);
    try {
      const res = await enablePush(config, areas, minSeverity);
      setPermission(res.permission);
      setStored(res.stored);
      if (res.stored) toast.success("Emergency notifications are on", { description: "This device will get demo alerts for the areas you chose." });
    } catch (e) {
      toast.error("Couldn’t turn on notifications", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      setStored(await updatePrefs(areas, minSeverity));
      toast.success("Alert areas saved");
    } catch (e) {
      toast.error("Couldn’t save your areas", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await disablePush();
      setStored(null);
      toast.success("Emergency notifications are off on this device");
    } finally {
      setBusy(false);
    }
  }

  const district = config?.areas.filter((a) => a.kind === "district") ?? [];
  const localities = config?.areas.filter((a) => a.kind === "locality") ?? [];
  const subscribed = Boolean(stored) && permission === "granted";

  return (
    <section id="notifications" aria-labelledby="notif-h" className="scroll-mt-20 rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b p-4">
        <div>
          <h2 id="notif-h" className="text-lg font-bold">Emergency notifications</h2>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">
            Get flood warnings for the areas you choose, even when SURAKSHA is closed. Used only for alerts sent by the operations team. We never use your location.
          </p>
        </div>
        <StatusBadge tone={subscribed ? "ok" : permission === "denied" ? "danger" : "muted"}>
          {subscribed ? "On for this device" : permission === "denied" ? "Blocked" : "Off"}
        </StatusBadge>
      </div>

      <div className="space-y-4 p-4">
        <fieldset>
          <legend className="text-sm font-semibold">Areas</legend>
          <p className="text-xs text-muted-foreground">Choosing the whole district includes every locality in it. These areas also filter the alerts you see in the app.</p>
          <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {[...district, ...localities].map((a) => (
              <Label key={a.code} className="flex min-h-10 items-center gap-2.5 rounded-md px-1 text-sm font-normal hover:bg-muted/50">
                <Checkbox checked={areas.includes(a.code)} onCheckedChange={(v) => toggleArea(a.code, v === true)} />
                <span className={a.kind === "district" ? "font-semibold" : undefined}>{a.name}</span>
              </Label>
            ))}
            {!config && !loadError && <p className="text-sm text-muted-foreground">Loading areas…</p>}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="min-sev" className="text-sm font-semibold">Notify me about</Label>
          <Select value={minSeverity} onValueChange={(v) => setMinSeverity(v as MinSeverity)}>
            <SelectTrigger id="min-sev" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="advisory">All alerts</SelectItem>
              <SelectItem value="warning">Warnings and above</SelectItem>
              <SelectItem value="severe">Severe and critical only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div role="status" className="text-sm">
          {loadError && <p className="text-[#a3241e]">Can’t reach the SURAKSHA server, so notifications can’t be set up right now. {loadError}</p>}
          {config && !config.enabled && <p className="text-muted-foreground">Push notifications aren’t configured on this server yet. In-app alerts still work while this page is open.</p>}
          {support === "insecure" && <p className="text-muted-foreground">Notifications need a secure (HTTPS) connection. Open SURAKSHA over https:// or on localhost.</p>}
          {support === "unsupported" && <p className="text-muted-foreground">This browser doesn’t support web notifications. In-app alerts still appear while SURAKSHA is open.</p>}
          {support === "needs-install" && (
            <p className="flex gap-2 text-muted-foreground">
              <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
              On iPhone and iPad, tap Share, then Add to Home Screen. Open SURAKSHA from the Home Screen icon to turn on notifications (iOS 16.4 or later).
            </p>
          )}
          {permission === "denied" && (
            <p className="text-[#a3241e]">Notifications are blocked for this site. Allow them in your browser’s site settings, then try again. In-app alerts still work.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!subscribed ? (
            <Button onClick={enable} disabled={busy || !config?.enabled || support !== "supported" || permission === "denied" || areas.length === 0} className="h-11">
              <BellRing className="size-4" aria-hidden />
              Enable Emergency Notifications
            </Button>
          ) : (
            <>
              <Button onClick={save} disabled={busy || areas.length === 0} className="h-11">Save areas</Button>
              <Button onClick={disable} disabled={busy} variant="outline" className="h-11">
                <BellOff className="size-4" aria-hidden />
                Turn off on this device
              </Button>
            </>
          )}
        </div>
        {!subscribed && areas.length === 0 && config?.enabled && <p className="text-xs text-muted-foreground">Choose at least one area first.</p>}
        <p className="text-xs text-muted-foreground">
          Demonstration build: every alert is a labelled [DEMO] message, not an official warning. Delivery depends on your browser and its push service and is not guaranteed. For emergencies call 112.
        </p>
      </div>
    </section>
  );
}
