import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/studio/ConfirmButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MUSIC_PRESETS,
  STUDIO_KEYS,
  buildControls,
  changeFormDefaults,
  requestChanges,
  type ChangeForm,
  type StudioEdit,
  type StudioRender,
} from "@/lib/studio";

const CUSTOM = "custom";

/** Owner change request (plan F4): structured controls + a note -> revise job on the station. */
export function ChangeRequest({
  projectId,
  edit,
  render,
  busy,
  nextVersion,
}: {
  projectId: string;
  edit: StudioEdit;
  render: StudioRender | null;
  busy: boolean;
  nextVersion: number;
}) {
  const qc = useQueryClient();
  const base = useMemo(() => changeFormDefaults(edit, render), [edit, render]);
  const [form, setForm] = useState<ChangeForm>(base);
  const [note, setNote] = useState("");
  const [baseId, setBaseId] = useState(edit.id);
  if (baseId !== edit.id) {
    // another version was selected: start over from its values
    setBaseId(edit.id);
    setForm(base);
    setNote("");
  }
  const set = <K extends keyof ChangeForm>(k: K, v: ChangeForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const controls = useMemo(() => buildControls(base, form, edit.plan), [base, form, edit.plan]);
  const changed = Object.keys(controls).length;
  const scriptRows = form.vo_text.split("\n").filter((l) => l.trim()).length;
  const preset = MUSIC_PRESETS.find((p) => p.prompt === form.music_prompt.trim())?.id ?? CUSTOM;

  const m = useMutation({
    mutationFn: () => requestChanges(projectId, edit.id, controls, note.trim()),
    onSuccess: () => {
      toast.success("Cambios pedidos. La PC arma la nueva versión.");
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.project(projectId) });
      qc.invalidateQueries({ queryKey: STUDIO_KEYS.projects });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = [
    controls.duration_s != null && `duración ${controls.duration_s} s`,
    controls.end_hold_s != null && `logo final ${controls.end_hold_s.toFixed(1)} s`,
    controls.voiceover &&
      (controls.voiceover.enabled ? "voz en off (ElevenLabs)" : "sin voz en off"),
    controls.music && (controls.music.enabled ? "música (ElevenLabs Music)" : "sin música"),
    controls.plate_style && `patentes con ${controls.plate_style === "logo" ? "logo" : "blur"}`,
    controls.caption != null && "texto de Instagram",
  ].filter(Boolean) as string[];
  const usesCredits = !!(controls.voiceover?.enabled || controls.music?.enabled);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Pedir cambios</CardTitle>
          <CardDescription>
            Parte de la versión {edit.version}. La PC arma una versión nueva; esta queda guardada.
          </CardDescription>
        </div>
        {changed > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setForm(base);
              setNote("");
            }}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Deshacer
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              Duración: <strong>{form.duration_s} s</strong>
              <span className="text-muted-foreground"> (ahora {base.duration_s} s)</span>
            </Label>
            <Slider
              min={10}
              max={30}
              step={1}
              value={[form.duration_s]}
              onValueChange={([v]) => set("duration_s", v)}
              aria-label="Duración del reel"
            />
          </div>
          <div className="space-y-2">
            <Label>
              Logo final: <strong>{form.end_hold_s.toFixed(1)} s</strong>
              <span className="text-muted-foreground"> (ahora {base.end_hold_s.toFixed(1)} s)</span>
            </Label>
            <Slider
              min={1.5}
              max={5}
              step={0.5}
              value={[form.end_hold_s]}
              onValueChange={([v]) => set("end_hold_s", v)}
              aria-label="Duración del logo final"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="vo">Voz en off (voz de Tomas, ElevenLabs)</Label>
            <Switch
              id="vo"
              checked={form.vo_enabled}
              onCheckedChange={(v) => set("vo_enabled", v)}
            />
          </div>
          {form.vo_enabled && (
            <>
              <Textarea
                rows={Math.min(6, Math.max(3, scriptRows + 1))}
                value={form.vo_text}
                onChange={(e) => set("vo_text", e.target.value)}
                aria-label="Guion de la voz en off"
              />
              <p className="text-xs text-muted-foreground">
                Una frase por renglón (máx. 6): la primera abre el reel, la última cae sobre el
                logo. “Washero” se pronuncia “uashero” automáticamente. Si la voz no entra en la
                duración, se acelera un poco o queda marcado en el QC.
              </p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="music">Música de fondo (original, ElevenLabs Music)</Label>
            <Switch
              id="music"
              checked={form.music_enabled}
              onCheckedChange={(v) => set("music_enabled", v)}
            />
          </div>
          {form.music_enabled && (
            <div className="space-y-2">
              <Select
                value={preset}
                onValueChange={(v) => {
                  const p = MUSIC_PRESETS.find((x) => x.id === v);
                  set("music_prompt", p ? p.prompt : "");
                }}
              >
                <SelectTrigger aria-label="Estilo de música">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MUSIC_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Otra (describila)</SelectItem>
                </SelectContent>
              </Select>
              {preset === CUSTOM && (
                <Textarea
                  rows={2}
                  placeholder="Ej.: instrumental tranquilo con piano y percusión suave, sin voces"
                  value={form.music_prompt}
                  onChange={(e) => set("music_prompt", e.target.value)}
                  aria-label="Descripción de la música"
                />
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Patentes</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            className="justify-start"
            value={form.plate_style}
            onValueChange={(v) => v && set("plate_style", v as ChangeForm["plate_style"])}
          >
            <ToggleGroupItem value="logo">Tapa con logo WASHERO</ToggleGroupItem>
            <ToggleGroupItem value="blur">Blur</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="caption">Texto para Instagram</Label>
          <Textarea
            id="caption"
            rows={3}
            value={form.caption}
            onChange={(e) => set("caption", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="note">Nota (opcional)</Label>
          <Textarea
            id="note"
            rows={2}
            placeholder="Queda guardada con la versión. Lo que cambia el video son los controles de arriba."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="text-xs text-muted-foreground">
            {busy
              ? "Hay un trabajo en curso: esperá a que termine."
              : changed
                ? `Cambia: ${summary.join(", ")}.`
                : "Mové algún control para pedir una versión nueva."}
          </span>
          <ConfirmButton
            disabled={busy || changed === 0 || m.isPending || (form.vo_enabled && scriptRows === 0)}
            title={`¿Armar la versión ${nextVersion}?`}
            description={
              <>
                Cambia: {summary.join(", ")}.
                {usesCredits &&
                  " La voz y la música se generan con ElevenLabs (usa créditos del plan)."}{" "}
                Si ya había una versión aprobada, la aprobación se quita hasta que apruebes la
                nueva.
              </>
            }
            confirmLabel="Armar nueva versión"
            onConfirm={() => m.mutate()}
          >
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Armar nueva versión
          </ConfirmButton>
        </div>
      </CardContent>
    </Card>
  );
}
