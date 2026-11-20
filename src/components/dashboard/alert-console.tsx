"use client";

import { Bell, LogOut, Megaphone, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL, ApiError, SEVERITY_LABEL, SEVERITY_TONE, api, type AlertLanguage, type AlertSeverity, type PublishedAlert, type PushConfig } from "@/features/notifications/api";

const TOKEN_KEY = "suraksha-admin-token";
const SEVERITIES: AlertSeverity[] = ["advisory", "warning", "severe", "critical"];
const EXPIRY = { none: "No expiry", "1": "1 hour", "6": "6 hours", "24": "24 hours" } as const;

interface Dispatch {
  id: string;
  status: "running" | "completed" | "failed";
  eligible: number;
  accepted: number;
  failed: number;
  invalid: number;
  error: string | null;
}
type AdminAlert = PublishedAlert & { dispatch: Dispatch | null };
interface Draft {
  alert: PublishedAlert;
  preview: { notification: { title: string; body: string; url: string }; audienceLabel: string; eligibleSubscriptions: number; pushEnabled: boolean };
}
interface Form {
  title: string;
  body: string;
  severity: AlertSeverity;
  targetArea: string;
  language: AlertLanguage;
  expiry: keyof typeof EXPIRY;
  inApp: boolean;
  push: boolean;
}

const TEMPLATES: { label: string; form: Partial<Form> }[] = [
  { label: "Severe flood warning (EN)", form: { title: "Severe Flood Warning — Darbhanga", body: "River levels are rising quickly near Darbhanga. Move to the nearest open shelter now and avoid flooded roads.", severity: "severe", targetArea: "darbhanga", language: "en", expiry: "6" } },
  { label: "Road closure advisory (EN)", form: { title: "Laheriasarai underpass closed", body: "The Laheriasarai underpass is under water. Use the Donar link road or check Routes before you travel.", severity: "advisory", targetArea: "darbhanga/laheriasarai", language: "en", expiry: "24" } },
  { label: "Shelter capacity update (EN)", form: { title: "Benta Stadium Camp nearly full", body: "Benta Stadium Camp has few places left. Kadirabad School shelter still has space and medical support.", severity: "warning", targetArea: "darbhanga/benta", language: "en", expiry: "6" } },
  { label: "Evacuate now (EN)", form: { title: "Evacuate now — Mabbi", body: "Water is entering homes in Mabbi. Leave now with your family and go to the nearest shelter. Do not walk through moving water.", severity: "critical", targetArea: "darbhanga/mabbi", language: "en", expiry: "1" } },
  { label: "बाढ़ चेतावनी (HI)", form: { title: "बाढ़ चेतावनी — दरभंगा", body: "दरभंगा में नदी का जलस्तर तेज़ी से बढ़ रहा है। नज़दीकी खुले आश्रय स्थल पर जाएँ और पानी भरी सड़कों से बचें।", severity: "severe", targetArea: "darbhanga", language: "hi", expiry: "6" } },
  { label: "सड़क बंद (HI)", form: { title: "लहेरियासराय अंडरपास बंद", body: "लहेरियासराय अंडरपास में पानी भरा है। यात्रा से पहले वैकल्पिक मार्ग देखें।", severity: "advisory", targetArea: "darbhanga/laheriasarai", language: "hi", expiry: "24" } },
];

const EMPTY: Form = { title: "", body: "", severity: "warning", targetArea: "darbhanga", language: "en", expiry: "6", inApp: true, push: true };

const TOKEN_EVENT = "suraksha-admin-token";
const onTokenChange = (cb: () => void) => {
  window.addEventListener(TOKEN_EVENT, cb);
  return () => window.removeEventListener(TOKEN_EVENT, cb);
};

/** Admin JWT for this tab only (sessionStorage), read as an external store so the server render stays signed-out. */
function useAdminToken() {
  const token = useSyncExternalStore(onTokenChange, () => sessionStorage.getItem(TOKEN_KEY), () => null);
  const save = useCallback((t: string | null) => {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event(TOKEN_EVENT));
  }, []);
  return [token, save] as const;
}

function SignIn({ onToken }: { onToken: (t: string) => void }) {
  const [email, setEmail] = useState("admin@suraksha.demo");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: { role: string } }>("/auth/login", { method: "POST", body: { email, password } });
      if (res.user.role !== "admin") setError("This account isn’t an administrator. Only administrators can send alerts.");
      else onToken(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-6 max-w-sm space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="text-lg font-bold">Administrator sign-in</h2>
        <p className="text-sm text-muted-foreground">Sending alerts needs an administrator account on the SURAKSHA API.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adm-email">Email</Label>
        <Input id="adm-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adm-pass">Password</Label>
        <Input id="adm-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p role="alert" className="text-sm text-[#a3241e]">{error}</p>}
      <Button type="submit" disabled={busy} className="h-11 w-full">Sign in</Button>
    </form>
  );
}

/** Mimics an OS notification so the operator sees what recipients will see. */
function NotificationPreview({ title, body, severity, area, language }: { title: string; body: string; severity: AlertSeverity; area: string; language: AlertLanguage }) {
  return (
    <div className="rounded-xl border bg-[#eef1f0] p-3">
      <div className="rounded-lg bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="grid size-5 place-items-center rounded bg-primary text-primary-foreground"><Bell className="size-3" aria-hidden /></span>
          SURAKSHA · now
        </div>
        <p className="mt-1.5 text-sm font-semibold" lang={language}>{title || "Alert title"}</p>
        <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground" lang={language}>{body || "Alert message"}</p>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Severity</dt>
        <dd><StatusBadge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</StatusBadge></dd>
        <dt className="text-muted-foreground">Area</dt>
        <dd className="font-medium">{area}</dd>
        <dt className="text-muted-foreground">Classification</dt>
        <dd className="font-medium">Demonstration, not verified</dd>
      </dl>
    </div>
  );
}

export function AlertConsole() {
  const [token, setToken] = useAdminToken();
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sendKey, setSendKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<AdminAlert[]>([]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        toast.error("Session expired. Sign in again.");
        return true;
      }
      return false;
    },
    [setToken],
  );

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      setHistory((await api<{ data: AdminAlert[] }>("/admin/alerts", { token })).data);
    } catch (err) {
      if (!onAuthError(err)) toast.error("Couldn’t load alert history", { description: (err as Error).message });
    }
  }, [token, onAuthError]);

  useEffect(() => {
    api<PushConfig>("/push/config").then(setConfig, () => setConfig(null));
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, { path: "/socket.io", auth: { token } });
    socket.on("connect", () => void loadHistory()); // initial load and catch-up after reconnects
    socket.on("alert.dispatch.updated", () => void loadHistory());
    socket.on("alert.published", () => void loadHistory());
    return () => void socket.disconnect();
  }, [token, loadHistory]);

  const areaName = useMemo(() => {
    const a = config?.areas.find((x) => x.code === form.targetArea);
    return form.targetArea === "all" ? "All demo subscribers" : a ? (form.language === "hi" ? a.nameHi : a.name) : form.targetArea;
  }, [config, form.targetArea, form.language]);

  if (!token) {
    return (
      <div className="p-4 md:p-6">
        <Header />
        <SignIn onToken={setToken} />
      </div>
    );
  }

  async function prepare(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const expiresAt = form.expiry === "none" ? undefined : new Date(Date.now() + Number(form.expiry) * 3_600_000).toISOString();
      const d = await api<Draft>("/admin/alerts", {
        method: "POST",
        token,
        body: { title: form.title, body: form.body, severity: form.severity, targetArea: form.targetArea, language: form.language, expiresAt, deliverInApp: form.inApp, deliverPush: form.push },
      });
      setDraft(d);
      setSendKey(crypto.randomUUID()); // one key per draft: double clicks and retries can’t send twice
    } catch (err) {
      if (!onAuthError(err)) toast.error("Couldn’t prepare the alert", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!draft || !sendKey) return;
    setBusy(true);
    try {
      await api(`/admin/alerts/${draft.alert.id}/send`, { method: "POST", token, body: { confirm: true }, headers: { "Idempotency-Key": sendKey } });
      toast.success("Alert sent", { description: draft.alert.deliverPush ? "Push delivery is running. Results appear in the history below." : "Published in the app." });
      setDraft(null);
      setSendKey(null);
      setForm(EMPTY);
      void loadHistory();
    } catch (err) {
      if (!onAuthError(err)) toast.error("Alert not sent", { description: (err as Error).message });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const locked = draft !== null;
  const previewTitle = draft?.preview.notification.title ?? (form.title ? `[DEMO] ${form.title.replace(/^\s*\[DEMO\]\s*/i, "")}` : "");
  const previewBody = draft?.preview.notification.body ?? form.body;
  const pushOff = config !== null && !config.enabled;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <Header onSignOut={() => setToken(null)} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <form onSubmit={prepare} className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="composer-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="composer-h" className="font-semibold">Compose</h2>
            <Select onValueChange={(i) => setForm({ ...EMPTY, ...TEMPLATES[Number(i)]!.form })} disabled={locked}>
              <SelectTrigger className="h-9 w-56" aria-label="Start from a template"><SelectValue placeholder="Start from a template" /></SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((t, i) => <SelectItem key={t.label} value={String(i)}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <fieldset disabled={locked} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="al-title">Title</Label>
              <Input id="al-title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={110} required minLength={3} lang={form.language} placeholder="Flood Warning — Darbhanga" />
              <p className="text-xs text-muted-foreground">Sent as “[DEMO] {form.title || "…"}”. The prefix is added automatically.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-body">Message</Label>
              <Textarea id="al-body" value={form.body} onChange={(e) => set("body", e.target.value)} maxLength={500} minLength={10} required rows={4} lang={form.language} />
              <p className={cn("text-right text-xs", form.body.length > 450 ? "text-[#8a5806]" : "text-muted-foreground")}>{form.body.length}/500</p>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Severity</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup">
                {SEVERITIES.map((s) => (
                  <label key={s} className={cn("flex h-10 cursor-pointer items-center justify-center rounded-md border text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", form.severity === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    <input type="radio" name="severity" value={s} checked={form.severity === s} onChange={() => set("severity", s)} className="sr-only" />
                    {SEVERITY_LABEL[s]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="al-area">Area</Label>
                <Select value={form.targetArea} onValueChange={(v) => set("targetArea", v)}>
                  <SelectTrigger id="al-area" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All demo subscribers</SelectItem>
                    {config?.areas.map((a) => <SelectItem key={a.code} value={a.code}>{a.kind === "district" ? a.name : `— ${a.name}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-lang">Language</Label>
                <Select value={form.language} onValueChange={(v) => set("language", v as AlertLanguage)}>
                  <SelectTrigger id="al-lang" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="hi">हिन्दी (Hindi)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-exp">Valid for</Label>
                <Select value={form.expiry} onValueChange={(v) => set("expiry", v as Form["expiry"])}>
                  <SelectTrigger id="al-exp" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPIRY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
              <legend className="mb-1.5 text-sm font-medium">Delivery</legend>
              <Label className="flex min-h-10 items-center gap-2 font-normal"><Checkbox checked={form.inApp} onCheckedChange={(v) => set("inApp", v === true)} />In-app alert</Label>
              <Label className="flex min-h-10 items-center gap-2 font-normal"><Checkbox checked={form.push} onCheckedChange={(v) => set("push", v === true)} disabled={pushOff} />Push notification</Label>
            </fieldset>
            {pushOff && <p className="text-xs text-[#8a5806]">Push isn’t configured on the API (VAPID keys missing). Only in-app delivery is available.</p>}
          </fieldset>

          {!locked ? (
            <Button type="submit" disabled={busy || (!form.inApp && !(form.push && !pushOff))} className="h-11">
              Prepare alert
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setConfirmOpen(true)} disabled={busy} className="h-11 bg-danger text-white hover:bg-danger/90">
                <Send className="size-4" aria-hidden />
                Send alert…
              </Button>
              <Button type="button" variant="outline" onClick={() => { setDraft(null); setSendKey(null); }} disabled={busy} className="h-11">Edit</Button>
            </div>
          )}
        </form>

        <section aria-labelledby="preview-h" className="space-y-3 rounded-lg border bg-card p-4">
          <h2 id="preview-h" className="font-semibold">Preview</h2>
          <NotificationPreview title={previewTitle} body={previewBody} severity={form.severity} area={areaName} language={form.language} />
          <div className="rounded-md border p-3 text-sm" role="status">
            {draft ? (
              <>
                <p className="font-semibold">Audience: {draft.preview.audienceLabel}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {draft.alert.deliverPush ? `${draft.preview.eligibleSubscriptions} push subscription${draft.preview.eligibleSubscriptions === 1 ? "" : "s"} eligible right now.` : "Push not selected."}
                  {draft.alert.deliverInApp && " Shown in the app to everyone viewing these areas."}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Prepare the alert to see the exact message and how many subscriptions it will reach.</p>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="hist-h" className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="hist-h" className="font-semibold">Sent and draft alerts</h2>
          <Button variant="ghost" size="sm" onClick={() => void loadHistory()}><RefreshCw className="size-4" aria-hidden />Refresh</Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alert</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Eligible</TableHead>
                <TableHead className="text-right" title="Accepted by the push service. Not a confirmed receipt.">Accepted</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right" title="Subscription no longer exists and was removed">Invalid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No alerts yet. Compose one above.</TableCell></TableRow>
              )}
              {history.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-[320px]">
                    <span className="flex items-center gap-2">
                      <StatusBadge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</StatusBadge>
                      <span className="truncate font-medium" lang={a.language}>{a.title}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{a.sentAt ? `Sent ${formatTime(a.sentAt)}` : `Drafted ${formatTime(a.createdAt)}`}{a.expired && " · expired"}</span>
                  </TableCell>
                  <TableCell className="text-sm">{a.targetAreaLabel}</TableCell>
                  <TableCell>
                    <StatusBadge tone={a.status === "sent" ? "ok" : a.status === "failed" ? "danger" : a.status === "sending" ? "info" : "muted"}>
                      {a.status === "sending" ? "Sending" : a.status === "sent" ? "Sent" : a.status === "failed" ? "Failed" : "Draft"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.dispatch && a.deliverPush ? a.dispatch.eligible : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.dispatch && a.deliverPush ? a.dispatch.accepted : "—"}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", a.dispatch?.failed && "text-[#a3241e]")}>{a.dispatch && a.deliverPush ? a.dispatch.failed : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.dispatch && a.deliverPush ? a.dispatch.invalid : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">“Accepted” means the browser’s push service took the message. It doesn’t confirm the device showed it or the person read it.</p>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this demonstration alert?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p className="font-semibold text-foreground" lang={form.language}>{draft?.alert.title}</p>
                <p>
                  {draft?.alert.deliverPush ? `Push to ${draft.preview.eligibleSubscriptions} subscription${draft.preview.eligibleSubscriptions === 1 ? "" : "s"}` : "No push"}
                  {draft?.alert.deliverInApp ? " and in-app" : ""} for {draft?.preview.audienceLabel}. It can’t be recalled once sent.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void send(); }} disabled={busy} className="bg-danger text-white hover:bg-danger/90">
              Send alert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Header({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Megaphone className="size-5 text-primary" aria-hidden />
        <div>
          <h1 className="text-xl font-bold">Alert management</h1>
          <p className="text-sm text-muted-foreground">Compose, preview and send demonstration alerts to subscribed devices.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DemoBadge label="Alerts are labelled [DEMO]" />
        {onSignOut && <Button variant="ghost" size="sm" onClick={onSignOut}><LogOut className="size-4" aria-hidden />Sign out</Button>}
      </div>
    </div>
  );
}
