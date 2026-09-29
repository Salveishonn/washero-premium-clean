import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { parseArgentinaMobile } from "@/lib/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type CustomerFormInitial = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  notes: string | null;
};

export function CustomerForm({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: CustomerFormInitial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [full_name, setFullName] = useState(initial?.full_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [neighborhood, setNeighborhood] = useState(initial?.neighborhood ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!full_name.trim()) return toast.error("El nombre es obligatorio.");
    const parsedPhone = parseArgentinaMobile(phone);
    if (!parsedPhone.ok) return toast.error(parsedPhone.error);
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return toast.error("Email inválido.");
    }

    setBusy(true);
    try {
      const payload = {
        full_name: full_name.trim(),
        phone: parsedPhone.display,
        email: email.trim() || null,
        address: address.trim() || null,
        neighborhood: neighborhood.trim() || null,
        notes: notes.trim() || null,
      };
      if (mode === "create") {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .in("phone", parsedPhone.lookupVariants)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          toast.error("Ya existe un cliente con ese teléfono.");
          setBusy(false);
          return;
        }
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
        toast.success("Cliente creado.");
      } else if (initial) {
        const { error } = await supabase.from("customers").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast.success("Cliente actualizado.");
      }
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al guardar";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Nuevo cliente" : "Editar cliente"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Nombre *</Label>
          <Input value={full_name} onChange={(e) => setFullName(e.target.value)} required maxLength={120} />
        </div>
        <div>
          <Label>Teléfono *</Label>
          <Input
            value={phone}
            inputMode="tel"
            placeholder="+54 9 11 1234-5678"
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => {
              const parsed = parseArgentinaMobile(phone);
              if (parsed.ok) setPhone(parsed.display);
            }}
            required
            maxLength={40}
          />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        </div>
        <div className="sm:col-span-2">
          <Label>Dirección</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={250} />
        </div>
        <div className="sm:col-span-2">
          <Label>Barrio</Label>
          <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} maxLength={120} />
        </div>
        <div className="sm:col-span-2">
          <Label>Notas</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}
