import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  MessageCircle,
  MapPin,
  Sparkles,
  Calendar,
  Car,
  Home,
  Building2,
  ShieldCheck,
  Clock,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscountCodePopup } from "@/components/DiscountCodePopup";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/booking-badges";

const WA_URL = "https://wa.me/5491176247835";
const SITE = "https://washero.ar";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "Washero | Lavado de autos a domicilio en Zona Norte" },
      {
        name: "description",
        content:
          "Reservá tu lavado de autos a domicilio en Zona Norte. Washero va a tu casa, barrio o empresa. Booking online rápido y simple.",
      },
      { property: "og:title", content: "Washero | Lavado de autos a domicilio en Zona Norte" },
      {
        property: "og:description",
        content:
          "Reservá tu lavado de autos a domicilio en Zona Norte. Vamos a tu casa, barrio o empresa.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: "Washero",
          description: "Lavado de autos a domicilio en Zona Norte, Buenos Aires.",
          telephone: "+54 9 11 7624-7835",
          areaServed: [
            "Maschwitz",
            "Nordelta",
            "Escobar",
            "San Isidro",
            "Tigre",
            "Pilar",
            "Benavídez",
            "Villa Nueva",
          ],
          url: SITE,
        }),
      },
    ],
  }),
  component: LandingPage,
});

// ===========================================================================
// Page
// ===========================================================================

function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Services />
      <Coverage />
      <Benefits />
      <Launch />
      <Faq />
      <FinalCta />
      <StickyMobileCta />
      <DiscountCodePopup />
    </>
  );
}

// ===========================================================================
// Hero
// ===========================================================================

function Hero() {
  return (
    <section id="inicio" className="relative overflow-hidden bg-neutral-950 text-white">
      {/* Decorative glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, oklch(0.78 0.18 75 / 0.6), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 py-20 md:py-32">
        <div className="max-w-3xl">
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            <span className="mr-2 h-1.5 w-1.5 rounded-full bg-primary" />
            Zona Norte · Buenos Aires
          </Badge>
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Lavado de autos a <span className="text-primary">domicilio</span> en Zona Norte
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-neutral-300 md:text-xl">
            Reservá tu lavado online en menos de 1 minuto. Nosotros vamos a tu casa, barrio o
            empresa.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild className="text-base">
              <Link to="/reservar">
                Reservar lavado <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <a href={WA_URL} target="_blank" rel="noopener">
                <MessageCircle className="mr-1 h-4 w-4" />
                Consultar por WhatsApp
              </a>
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {["A domicilio", "Reserva online", "Zona Norte", "Servicio premium"].map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-neutral-200"
              >
                <CheckCircle2 className="h-3 w-3 text-primary" /> {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// How it works
// ===========================================================================

function HowItWorks() {
  const steps = [
    {
      icon: Car,
      title: "Elegí tu lavado",
      body: "Seleccioná el servicio que querés para tu auto.",
    },
    {
      icon: Calendar,
      title: "Reservá día y horario",
      body: "Elegí un turno disponible desde la web.",
    },
    {
      icon: Home,
      title: "Vamos a tu ubicación",
      body: "Lavamos tu auto en tu casa, cochera, barrio o empresa.",
    },
  ];
  return (
    <section id="como-funciona" className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <SectionTitle eyebrow="Simple" title="¿Cómo funciona?" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <Card key={s.title} className="border-border/60">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <s.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Services
// ===========================================================================

function Services() {
  const q = useQuery({
    queryKey: ["public", "services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("id,name,description,base_price,duration_minutes")
        .eq("active", true)
        .order("base_price");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <section id="servicios" className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <SectionTitle eyebrow="Servicios" title="Elegí tu lavado" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {q.isLoading ? (
            <>
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </>
          ) : q.error || !q.data || q.data.length === 0 ? (
            <Card className="md:col-span-2 border-border/60">
              <CardContent className="space-y-3 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No pudimos cargar los servicios en este momento. Escribinos y te lo contamos al
                  instante.
                </p>
                <Button asChild>
                  <a href={WA_URL} target="_blank" rel="noopener">
                    <MessageCircle className="mr-1 h-4 w-4" /> Consultar por WhatsApp
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            q.data.map((s) => (
              <Card key={s.id} className="flex flex-col border-border/60">
                <CardContent className="flex flex-1 flex-col gap-4 p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xl font-semibold">{s.name}</h3>
                      {s.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                      )}
                    </div>
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-3xl font-bold">{formatPrice(s.base_price)}</div>
                      <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {s.duration_minutes} min
                      </div>
                    </div>
                    <Button asChild>
                      <Link to="/reservar">Reservar</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Coverage
// ===========================================================================

function Coverage() {
  const q = useQuery({
    queryKey: ["public", "coverage_zones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coverage_zones")
        .select("id,name,display_order")
        .eq("active", true)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <section id="zonas" className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <SectionTitle eyebrow="Cobertura" title="Zonas de cobertura" />
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted-foreground">
          Trabajamos principalmente en Zona Norte. Si tu zona no aparece, podés hacer la reserva
          igual y la revisamos manualmente.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {q.isLoading ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-24" />)
          ) : q.error || !q.data || q.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Consultá disponibilidad por{" "}
              <a className="text-primary underline" href={WA_URL} target="_blank" rel="noopener">
                WhatsApp
              </a>
              .
            </p>
          ) : (
            q.data.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm"
              >
                <MapPin className="h-3.5 w-3.5 text-primary" /> {a.name}
              </span>
            ))
          )}
        </div>

        <div className="mt-10 text-center">
          <Button size="lg" asChild>
            <Link to="/reservar">Reservar lavado</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Benefits
// ===========================================================================

function Benefits() {
  const items = [
    { icon: Home, title: "Sin moverte de tu casa", body: "Nosotros vamos a tu ubicación." },
    {
      icon: Calendar,
      title: "Reserva simple",
      body: "Agendás el lavado online en menos de 1 minuto.",
    },
    {
      icon: Building2,
      title: "Ideal para barrios y empresas",
      body: "Perfecto para casas, barrios cerrados, oficinas y flotas.",
    },
    {
      icon: ShieldCheck,
      title: "Servicio premium",
      body: "Cuidamos los detalles para que tu auto quede impecable.",
    },
  ];
  return (
    <section className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <SectionTitle eyebrow="Por qué Washero" title="Pensado para vos" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((b) => (
            <Card key={b.title} className="border-border/60">
              <CardContent className="p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <b.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{b.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Launch
// ===========================================================================

function Launch() {
  return (
    <section id="reservar" className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-4xl px-4 py-16 md:py-20">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
          <CardContent className="space-y-4 p-8 text-center">
            <Badge className="bg-primary text-primary-foreground">Cupos limitados</Badge>
            <h2 className="text-2xl font-bold md:text-3xl">Lanzamiento Washero</h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              Estamos comenzando en Zona Norte con cupos limitados por día para asegurar calidad y
              puntualidad.
            </p>
            <Button size="lg" asChild>
              <Link to="/reservar">Reservar ahora</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ===========================================================================
// FAQ
// ===========================================================================

function Faq() {
  const items = [
    {
      q: "¿Dónde lavan el auto?",
      a: "En tu casa, cochera, barrio, oficina o empresa, siempre que el lugar sea apto para realizar el servicio.",
    },
    {
      q: "¿Qué zonas cubren?",
      a: "Principalmente Zona Norte: Maschwitz, Nordelta, Escobar, San Isidro, Tigre, Pilar, Benavídez y Villa Nueva. Si estás en otra zona, revisamos disponibilidad.",
    },
    {
      q: "¿Cómo reservo?",
      a: "Desde la web en /reservar. Elegís servicio, zona, día, horario y método de pago.",
    },
    {
      q: "¿Cómo pago?",
      a: "Por ahora podés elegir Pagar después o Transferencia. Mercado Pago se sumará próximamente.",
    },
    {
      q: "¿Qué pasa si mi zona no aparece?",
      a: "Podés enviar la solicitud igual. La reserva queda en revisión y el equipo Washero te confirma por WhatsApp.",
    },
    {
      q: "¿Trabajan con empresas o flotas?",
      a: "Sí. Para flotas o empresas, escribinos por WhatsApp.",
    },
  ];
  return (
    <section id="faq" className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
        <SectionTitle eyebrow="Preguntas frecuentes" title="Resolvemos tus dudas" />
        <Accordion type="single" collapsible className="mt-8">
          {items.map((it, i) => (
            <AccordionItem key={i} value={`q-${i}`}>
              <AccordionTrigger className="text-left">{it.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{it.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

// ===========================================================================
// Final CTA
// ===========================================================================

function FinalCta() {
  return (
    <section className="border-t border-border/60 bg-neutral-950 text-white">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center md:py-24">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          ¿Listo para tener tu auto impecable sin moverte?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-neutral-300">
          Reservá en menos de 1 minuto y nosotros vamos a tu ubicación.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild>
            <Link to="/reservar">Reservar lavado</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            asChild
            className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            <a href={WA_URL} target="_blank" rel="noopener">
              <MessageCircle className="mr-1 h-4 w-4" /> Consultar por WhatsApp
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Sticky mobile CTA
// ===========================================================================

function StickyMobileCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur md:hidden">
      <div className="flex gap-2">
        <Button asChild className="flex-1">
          <Link to="/reservar">Reservar</Link>
        </Button>
        <Button asChild variant="outline" className="flex-1">
          <a href={WA_URL} target="_blank" rel="noopener">
            <MessageCircle className="mr-1 h-4 w-4" /> WhatsApp
          </a>
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
    </div>
  );
}
