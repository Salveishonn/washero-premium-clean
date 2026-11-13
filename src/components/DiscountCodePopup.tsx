import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { MessageCircle, Ticket, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const WHATSAPP_NUMBER = "5491176247835";
const WHATSAPP_MESSAGE =
  "¡Hola Washero! Vivo en un barrio cerrado y quiero mi código de descuento. Mi barrio es: ";
const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

const STORAGE_KEY = "washero:discount-popup-dismissed-at";
/** After closing it, the promo stays quiet for a few days instead of nagging every visit. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const OPEN_DELAY_MS = 3500;

function wasRecentlyDismissed() {
  try {
    const at = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled: the popup simply shows again next visit.
  }
}

/** Landing promo: gated-community residents can ask for their discount code on WhatsApp. */
export function DiscountCodePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (wasRecentlyDismissed()) return;
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  function onOpenChange(next: boolean) {
    if (!next) rememberDismissal();
    setOpen(next);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby="discount-popup-description"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-primary/40 bg-neutral-950 text-white shadow-2xl shadow-primary/20 duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 data-[state=open]:slide-in-from-bottom-6"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-28 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full opacity-50 blur-3xl"
            style={{
              background: "radial-gradient(closest-side, oklch(0.78 0.18 75 / 0.75), transparent)",
            }}
          />

          <DialogPrimitive.Close className="absolute right-3 top-3 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-4 w-4" />
            <span className="sr-only">Cerrar</span>
          </DialogPrimitive.Close>

          <div className="relative px-6 pb-6 pt-9 text-center sm:px-8">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
              <Ticket className="h-3.5 w-3.5" /> Beneficio exclusivo
            </span>

            <DialogPrimitive.Title className="mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
              ¿Vivís en un <span className="text-primary">barrio cerrado</span>?
            </DialogPrimitive.Title>

            <p id="discount-popup-description" className="mt-3 text-base text-neutral-300">
              Tu barrio tiene un <strong className="text-white">código de descuento</strong> para
              lavar tu auto sin moverte de casa. Pedinos el tuyo por WhatsApp y te lo mandamos al
              toque.
            </p>

            {/* Coupon stub */}
            <div className="relative mx-auto mt-5 flex max-w-xs items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-primary/10 px-4 py-3 text-left">
              <span
                aria-hidden
                className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-neutral-950"
              />
              <span
                aria-hidden
                className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-neutral-950"
              />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                  Código de tu barrio
                </p>
                <p className="font-mono text-xl font-bold tracking-[0.2em]">••••••</p>
              </div>
              <p className="text-right text-xs font-semibold leading-tight text-neutral-200">
                Descuento
                <br />
                en tu lavado
              </p>
            </div>

            <div className="mt-6 space-y-2">
              <Button
                asChild
                size="lg"
                className="h-12 w-full bg-[#25D366] text-base font-bold text-neutral-950 hover:bg-[#1fbe5b]"
              >
                <a
                  href={WHATSAPP_HREF}
                  target="_blank"
                  rel="noopener"
                  onClick={() => onOpenChange(false)}
                >
                  <MessageCircle className="mr-1 h-5 w-5" />
                  Pedir mi código por WhatsApp
                </a>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="w-full text-neutral-300 hover:bg-white/10 hover:text-white"
              >
                <Link to="/reservar" onClick={() => onOpenChange(false)}>
                  Ya tengo mi código — reservar
                </Link>
              </Button>
            </div>

            <p className="mt-3 text-[11px] text-neutral-500">
              Lo ingresás al reservar, antes de pagar.
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
