import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Clock, Loader2, MessageSquareText, Star, UserRoundX, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseArgentinaMobile } from "@/lib/phone";
import {
  BOT_TEXT_FIELDS,
  type BotSettings,
  type BotTextKey,
  DAY_KEYS,
  DAY_LABELS,
  DEFAULT_BOT_TEXTS,
  resolveBotSettings,
} from "../../supabase/functions/_shared/whatsapp-bot-settings";

export const Route = createFileRoute("/admin/whatsapp-config")({
  component: WhatsappBotConfigPage,
});

const SETTINGS_KEY = ["admin", "whatsapp_bot_settings"] as const;
const SILENCED_KEY = ["admin", "whatsapp_bot_silenced_chats"] as const;

/** Only what differs from the built-in texts is stored, so default texts can still evolve. */
function toStored(s: BotSettings): Json {
  const texts: Partial<Record<BotTextKey, string>> = {};
  for (const f of BOT_TEXT_FIELDS) {
    const v = s.texts[f.key].trim();
    if (v && v !== DEFAULT_BOT_TEXTS[f.key]) texts[f.key] = v;
  }
  return { ...s, texts } as unknown as Json;
}

function WhatsappBotConfigPage() {
  const qc = useQueryClient();
  const { data: loaded, isLoading } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_bot_settings")
        .select("settings,updated_at")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return { settings: resolveBotSettings(data?.settings ?? {}), updated_at: data?.updated_at ?? null };
    },
  });

  const [draft, setDraft] = useState<BotSettings | null>(null);
  useEffect(() => {
    if (loaded) setDraft(loaded.settings);
  }, [loaded]);

  const dirty = useMemo(
    () => !!draft && !!loaded && JSON.stringify(toStored(draft)) !== JSON.stringify(toStored(loaded.settings)),
    [draft, loaded],
  );

  const save = useMutation({
    mutationFn: async (s: BotSettings) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("whatsapp_bot_settings")
        .upsert({ id: true, settings: toStored(s), updated_by: auth.user?.id ?? null }, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuración del bot guardada");
      qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
    onError: (e: Error) => toast.error(`No se pudo guardar: ${e.message}`),
  });

  function patch(fn: (s: BotSettings) => BotSettings) {
    setDraft((cur) => (cur ? fn(structuredClone(cur)) : cur));
  }

  if (isLoading || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración del bot…
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="h-5 w-5" /> Bot de WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground">
            Qué dice el bot, cuándo responde y cuándo se queda callado. Los cambios se aplican al próximo mensaje.
          </p>
        </div>
        <Badge variant={draft.bot_enabled ? "default" : "destructive"}>
          {draft.bot_enabled ? "Bot activo" : "Bot pausado"}
        </Badge>
      </div>

      <Tabs defaultValue="estado" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="estado">Pausa y silencio</TabsTrigger>
          <TabsTrigger value="horario">Horario</TabsTrigger>
          <TabsTrigger value="textos">Textos</TabsTrigger>
          <TabsTrigger value="encuesta">Encuesta</TabsTrigger>
        </TabsList>

        <TabsContent value="estado" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Volume2 className="h-4 w-4" /> Estado del bot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="bot-enabled" className="text-sm font-medium">Bot activo</Label>
                  <p className="text-xs text-muted-foreground">
                    Apagado, el bot no contesta a nadie. Los formularios de reserva que el cliente ya abrió se procesan igual.
                  </p>
                </div>
                <Switch
                  id="bot-enabled"
                  checked={draft.bot_enabled}
                  onCheckedChange={(v) => patch((s) => ({ ...s, bot_enabled: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="takeover-hours" className="text-sm font-medium">
                  Horas de silencio cuando escribís a mano
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="takeover-hours"
                    type="number"
                    min={1}
                    max={72}
                    className="w-24"
                    value={draft.human_takeover_hours}
                    onChange={(e) => patch((s) => ({ ...s, human_takeover_hours: Number(e.target.value) || 1 }))}
                  />
                  <span className="text-sm text-muted-foreground">horas (1 a 72)</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cuando le escribís a un cliente desde la app de WhatsApp Business, el bot se calla en ese chat este tiempo.
                  Cada mensaje tuyo vuelve a empezar la cuenta.
                </p>
              </div>
            </CardContent>
          </Card>
          <SilencedChats takeoverHours={loaded?.settings.human_takeover_hours ?? 12} />
        </TabsContent>

        <TabsContent value="horario">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Horario de atención</CardTitle>
              <CardDescription>Hora de Buenos Aires.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="hours-enabled" className="text-sm font-medium">Usar horario de atención</Label>
                  <p className="text-xs text-muted-foreground">Apagado, el bot responde las 24 horas.</p>
                </div>
                <Switch
                  id="hours-enabled"
                  checked={draft.business_hours.enabled}
                  onCheckedChange={(v) => patch((s) => ({ ...s, business_hours: { ...s.business_hours, enabled: v } }))}
                />
              </div>

              <div className={draft.business_hours.enabled ? "space-y-5" : "pointer-events-none space-y-5 opacity-50"}>
                <div className="divide-y divide-border/60 rounded-md border">
                  {DAY_KEYS.map((k) => {
                    const d = draft.business_hours.days[k];
                    const setDay = (p: Partial<typeof d>) =>
                      patch((s) => {
                        s.business_hours.days[k] = { ...s.business_hours.days[k], ...p };
                        return s;
                      });
                    return (
                      <div key={k} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <Switch checked={d.on} onCheckedChange={(v) => setDay({ on: v })} aria-label={`Atender ${DAY_LABELS[k]}`} />
                        <span className="w-24 text-sm">{DAY_LABELS[k]}</span>
                        {d.on ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Input type="time" className="w-28" value={d.open} onChange={(e) => setDay({ open: e.target.value })} />
                            <span className="text-muted-foreground">a</span>
                            <Input type="time" className="w-28" value={d.close} onChange={(e) => setDay({ close: e.target.value })} />
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Cerrado</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Fuera de horario</Label>
                  <RadioGroup
                    value={draft.business_hours.after_hours_mode}
                    onValueChange={(v) =>
                      patch((s) => ({
                        ...s,
                        business_hours: { ...s.business_hours, after_hours_mode: v === "silent" ? "silent" : "message" },
                      }))}
                    className="space-y-1"
                  >
                    <label className="flex items-start gap-2 text-sm">
                      <RadioGroupItem value="message" className="mt-0.5" />
                      <span>
                        Mandar un aviso y seguir atendiendo
                        <span className="block text-xs text-muted-foreground">
                          El primer mensaje recibe el aviso (una vez cada 12 h); después el bot responde normal, así pueden reservar igual.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <RadioGroupItem value="silent" className="mt-0.5" />
                      <span>
                        Quedarse callado
                        <span className="block text-xs text-muted-foreground">No contesta nada hasta que vuelva el horario.</span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>

                {draft.business_hours.after_hours_mode === "message" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="after-hours-msg" className="text-sm font-medium">Aviso fuera de horario</Label>
                    <Textarea
                      id="after-hours-msg"
                      rows={3}
                      value={draft.business_hours.after_hours_message}
                      onChange={(e) =>
                        patch((s) => ({ ...s, business_hours: { ...s.business_hours, after_hours_message: e.target.value } }))}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="textos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4" /> Textos del bot</CardTitle>
              <CardDescription>
                Podés usar *negrita*, _cursiva_ y emojis como en WhatsApp. Un texto vacío vuelve al original.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {BOT_TEXT_FIELDS.map((f) => {
                const value = draft.texts[f.key];
                const isDefault = value.trim() === DEFAULT_BOT_TEXTS[f.key];
                return (
                  <div key={f.key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`txt-${f.key}`} className="text-sm font-medium">{f.label}</Label>
                      {isDefault ? (
                        <span className="text-xs text-muted-foreground">Original</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => patch((s) => ({ ...s, texts: { ...s.texts, [f.key]: DEFAULT_BOT_TEXTS[f.key] } }))}
                        >
                          Restaurar original
                        </Button>
                      )}
                    </div>
                    <Textarea
                      id={`txt-${f.key}`}
                      rows={Math.min(6, Math.max(2, Math.ceil(value.length / 80) + value.split("\n").length - 1))}
                      value={value}
                      onChange={(e) => patch((s) => ({ ...s, texts: { ...s.texts, [f.key]: e.target.value } }))}
                    />
                    <p className="text-xs text-muted-foreground">{f.help}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="encuesta">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Star className="h-4 w-4" /> Encuesta de satisfacción</CardTitle>
              <CardDescription>Se manda por WhatsApp después de cada lavado terminado, entre las 9 y las 22.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="survey-enabled" className="text-sm font-medium">Mandar encuesta</Label>
                  <p className="text-xs text-muted-foreground">Apagada, no se manda ninguna encuesta nueva.</p>
                </div>
                <Switch
                  id="survey-enabled"
                  checked={draft.survey.enabled}
                  onCheckedChange={(v) => patch((s) => ({ ...s, survey: { ...s.survey, enabled: v } }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="survey-delay" className="text-sm font-medium">Cuánto después del lavado</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="survey-delay"
                    type="number"
                    min={1}
                    max={47}
                    className="w-24"
                    value={draft.survey.delay_hours}
                    onChange={(e) => patch((s) => ({ ...s, survey: { ...s.survey, delay_hours: Number(e.target.value) || 1 } }))}
                  />
                  <span className="text-sm text-muted-foreground">horas</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="review-url" className="text-sm font-medium">Link de reseña de Google</Label>
                <Input
                  id="review-url"
                  type="url"
                  placeholder="https://g.page/r/…/review"
                  value={draft.survey.review_url}
                  onChange={(e) => patch((s) => ({ ...s, survey: { ...s.survey, review_url: e.target.value } }))}
                />
                <p className="text-xs text-muted-foreground">
                  Lo manda el bot cuando el cliente responde "¡Todo excelente!". Vacío usa el link configurado en el servidor.
                  El botón "Dejar reseña en Google" de la plantilla de Meta tiene su link fijo y no cambia desde acá.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-width,0px)]">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          {dirty && <span className="text-sm text-muted-foreground">Cambios sin guardar</span>}
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => loaded && setDraft(loaded.settings)}>
            Descartar
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}

type SilencedRow = {
  customer_phone: string;
  state: string;
  data: Record<string, unknown>;
  updated_at: string;
  name: string | null;
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayPhone(statePhone: string): string {
  const p = parseArgentinaMobile(statePhone);
  return p.ok ? p.display : statePhone;
}

/** Chats where the bot is quiet: a person wrote by hand (state human) or it handed off. */
function SilencedChats({ takeoverHours }: { takeoverHours: number }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [hours, setHours] = useState<number>(takeoverHours);
  useEffect(() => setHours(takeoverHours), [takeoverHours]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: SILENCED_KEY,
    refetchInterval: 60_000,
    queryFn: async (): Promise<SilencedRow[]> => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("whatsapp_conversation_state")
        .select("customer_phone,state,data,updated_at")
        .in("state", ["human", "handoff"])
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const now = Date.now();
      const active = (data ?? [])
        .map((r) => ({ ...r, data: (r.data ?? {}) as Record<string, unknown> }))
        .filter((r) => r.state === "handoff" || Date.parse(String(r.data.human_until ?? "")) > now);
      // Names from customers (phones are stored in several formats).
      const variantsByPhone = new Map<string, string[]>();
      for (const r of active) {
        const p = parseArgentinaMobile(r.customer_phone);
        variantsByPhone.set(r.customer_phone, p.ok ? p.lookupVariants : [r.customer_phone]);
      }
      const all = [...new Set([...variantsByPhone.values()].flat())];
      const nameByVariant = new Map<string, string>();
      if (all.length) {
        const { data: customers } = await supabase.from("customers").select("full_name,phone").in("phone", all.slice(0, 900));
        for (const c of customers ?? []) if (c.phone && c.full_name) nameByVariant.set(c.phone, c.full_name);
      }
      return active.map((r) => ({
        ...r,
        name: (variantsByPhone.get(r.customer_phone) ?? []).map((v) => nameByVariant.get(v)).find(Boolean) ?? null,
      }));
    },
  });

  const reactivate = useMutation({
    mutationFn: async (customerPhone: string) => {
      const { error } = await supabase
        .from("whatsapp_conversation_state")
        .update({ state: "none", data: { misses: 0 } })
        .eq("customer_phone", customerPhone);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bot reactivado en ese chat");
      qc.invalidateQueries({ queryKey: SILENCED_KEY });
    },
    onError: (e: Error) => toast.error(`No se pudo reactivar: ${e.message}`),
  });

  const silence = useMutation({
    mutationFn: async () => {
      const p = parseArgentinaMobile(phone);
      if (!p.ok) throw new Error(p.error);
      const h = Math.min(72, Math.max(1, Number(hours) || 1));
      const until = new Date(Date.now() + h * 3600_000).toISOString();
      const { error } = await supabase.from("whatsapp_conversation_state").upsert(
        { customer_phone: `549${p.national}`, state: "human", data: { human_until: until, misses: 0, silenced_by: "admin" } },
        { onConflict: "customer_phone" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bot silenciado en ese chat");
      setPhone("");
      qc.invalidateQueries({ queryKey: SILENCED_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><UserRoundX className="h-4 w-4" /> Chats con el bot callado</CardTitle>
        <CardDescription>
          Chats donde escribiste a mano o que el bot derivó a una persona. Reactivalo cuando termines de atender.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ningún chat silenciado ahora: el bot atiende a todos.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-md border">
            {rows.map((r) => (
              <li key={r.customer_phone} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.name ?? displayPhone(r.customer_phone)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.name ? `${displayPhone(r.customer_phone)} · ` : ""}
                    {r.state === "human"
                      ? `${r.data.silenced_by === "admin" ? "Silenciado desde acá" : "Escribiste a mano"} · callado hasta ${fmtWhen(String(r.data.human_until))}`
                      : `Derivado a una persona · ${fmtWhen(r.updated_at)}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reactivate.isPending}
                  onClick={() => reactivate.mutate(r.customer_phone)}
                >
                  Reactivar bot
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="silence-phone" className="text-sm font-medium">Silenciar un chat</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="silence-phone"
              placeholder="11 1234-5678"
              className="w-48"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              type="number"
              min={1}
              max={72}
              className="w-20"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 1)}
              aria-label="Horas"
            />
            <span className="text-sm text-muted-foreground">horas</span>
            <Button size="sm" disabled={!phone.trim() || silence.isPending} onClick={() => silence.mutate()}>
              Silenciar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
