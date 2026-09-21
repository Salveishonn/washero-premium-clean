import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidad — Washero" },
      {
        name: "description",
        content:
          "Política de privacidad de Washero: qué datos tratamos, para qué, con quién y cómo ejercer tus derechos.",
      },
      { property: "og:title", content: "Política de Privacidad — Washero" },
      {
        property: "og:description",
        content:
          "Información sobre el tratamiento de datos personales en el servicio de lavado a domicilio Washero.",
      },
    ],
    links: [{ rel: "canonical", href: "https://www.washero.ar/privacy" }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 prose-headings:scroll-mt-20">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Política de Privacidad</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: 10 de septiembre de 2026 · Washero
      </p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-foreground/90">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">1. Quiénes somos</h2>
          <p>
            Washero es un servicio de lavado de autos a domicilio que opera en Zona Norte (Área
            Metropolitana de Buenos Aires, Argentina). Este sitio web y las herramientas asociadas
            (reservas, panel operativo y comunicaciones) son operados por Washero.
          </p>
          <p>
            Contacto para privacidad y derechos: WhatsApp{" "}
            <a
              className="underline"
              href="https://wa.me/5491176247835"
              target="_blank"
              rel="noreferrer"
            >
              +54 9 11 7624-7835
            </a>
            . Indicá que tu mensaje es una solicitud de privacidad.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">2. Qué datos tratamos</h2>
          <p>Según cómo uses el servicio, podemos tratar:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Datos de contacto y reserva:</strong> nombre, teléfono (WhatsApp), dirección
              del servicio, barrio o zona, fecha y horario preferidos, tipo de vehículo/servicio y
              notas que nos envíes.
            </li>
            <li>
              <strong>Datos de pago:</strong> método elegido (por ejemplo transferencia o
              Mercado Pago), estado del pago e identificadores de comprobantes. No almacenamos el
              número completo de tarjetas en nuestros sistemas; el procesamiento de tarjetas lo
              realiza el proveedor de pagos.
            </li>
            <li>
              <strong>Comunicaciones:</strong> mensajes que intercambiamos por WhatsApp u otros
              canales que uses para coordinar el servicio, incluyendo confirmaciones, recordatorios
              y novedades operativas del lavado.
            </li>
            <li>
              <strong>Datos técnicos básicos:</strong> información de navegación necesaria para
              operar el sitio (por ejemplo logs de error o identificadores de sesión de
              autenticación en paneles internos).
            </li>
            <li>
              <strong>Personal interno:</strong> cuentas de administradores y operadores (email y
              rol) para acceder a herramientas de gestión.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">3. Para qué los usamos</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Gestionar reservas, agenda, cobertura y prestación del lavado a domicilio.</li>
            <li>
              Comunicarnos con vos por WhatsApp u otros medios sobre confirmación, estado del
              servicio (por ejemplo en camino o demoras), pagos y facturación/comprobantes.
            </li>
            <li>Procesar pagos y prevenir fraude o errores operativos.</li>
            <li>Mejorar la calidad del servicio y la disponibilidad en las zonas cubiertas.</li>
            <li>Cumplir obligaciones legales y responder a requerimientos válidos de autoridad.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">4. WhatsApp y mensajería</h2>
          <p>
            Usamos WhatsApp Business para atender consultas, confirmar reservas y enviar avisos
            operativos. El envío y recepción de mensajes puede realizarse a través de proveedores
            de mensajería empresarial (por ejemplo plataformas Business Solution Providers) y/o la
            API oficial de WhatsApp Business (Meta Platforms). Esos proveedores tratan el número de
            teléfono y el contenido necesario para entregar el mensaje según sus propias
            condiciones y políticas.
          </p>
          <p>
            Si nos escribís por WhatsApp, el tratamiento también está sujeto a las políticas de
            WhatsApp/Meta aplicables a tu cuenta.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">5. Proveedores / encargados</h2>
          <p>
            Para operar Washero compartimos datos solo con proveedores que los necesitan para el
            servicio, por ejemplo:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Infraestructura y base de datos (Supabase).</li>
            <li>Hosting del sitio (Vercel).</li>
            <li>Pagos (Mercado Pago, cuando corresponde).</li>
            <li>Mensajería WhatsApp (Meta WhatsApp Business Platform, operada desde n8n).</li>
            <li>Mapas / geolocalización de direcciones (Google Maps / Places), cuando usás el
              buscador de dirección en la reserva.</li>
            <li>Email transaccional de comprobantes (Resend), cuando está habilitado.</li>
          </ul>
          <p>
            No vendemos tus datos personales. Tampoco usamos esta política para autorizar usos
            incompatibles con la prestación del servicio de lavado.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">6. Conservación y eliminación</h2>
          <p>
            Conservamos los datos de reservas, clientes y comunicaciones el tiempo necesario para
            prestar el servicio, gestionar pagos/reclamaciones y cumplir obligaciones legales o
            contables. Cuando ya no sean necesarios para esos fines, los eliminamos o anonimizamos
            de forma razonable según nuestras prácticas operativas.
          </p>
          <p>
            Podés solicitar acceso, corrección o eliminación de tus datos de cliente escribiendo por
            WhatsApp al{" "}
            <a
              className="underline"
              href="https://wa.me/5491176247835"
              target="_blank"
              rel="noreferrer"
            >
              +54 9 11 7624-7835
            </a>
            . Verificaremos tu identidad antes de procesar el pedido y te responderemos en un plazo
            razonable.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">7. Seguridad</h2>
          <p>
            Aplicamos medidas técnicas y organizativas razonables (control de acceso a paneles
            internos, secretos de servidor, cifrado en tránsito vía HTTPS). Ningún sistema es 100%
            seguro; si detectás un incidente que involucre tus datos, contactanos de inmediato.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">8. Menores</h2>
          <p>
            El servicio está orientado a adultos que contratan un lavado de vehículo. No está
            dirigido a menores de 18 años.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">9. Cambios</h2>
          <p>
            Podemos actualizar esta política para reflejar cambios operativos o legales. La fecha
            de “última actualización” indica la versión vigente publicada en{" "}
            <a className="underline" href="https://www.washero.ar/privacy">
              https://www.washero.ar/privacy
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">10. Contacto</h2>
          <p>
            Washero — Zona Norte, Buenos Aires, Argentina
            <br />
            WhatsApp:{" "}
            <a
              className="underline"
              href="https://wa.me/5491176247835"
              target="_blank"
              rel="noreferrer"
            >
              +54 9 11 7624-7835
            </a>
            <br />
            Sitio:{" "}
            <a className="underline" href="https://www.washero.ar">
              https://www.washero.ar
            </a>
          </p>
        </section>
      </div>
    </article>
  );
}
