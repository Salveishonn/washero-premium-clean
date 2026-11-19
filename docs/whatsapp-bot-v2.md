# Bot de WhatsApp v2: flujo y despliegue

Estado: **implementado en la rama `whatsapp-bot-flow-v2`, sin desplegar.** El bot en producción
(n8n "Washero WhatsApp Inbound (deterministic)") todavía no cambió.

## Cómo queda el flujo para el cliente

```
Cliente escribe ("hola", "quiero reservar", "precios"...)
 ├─ Primer contacto → saludo + menú + aviso discreto de promos ("escribí *no promos*")
 ├─ "quiero reservar" / "turno" → directo al formulario (sin pasar por el menú)
 └─ Menú: Reservar turno · Mis reservas · Precios y zonas · Hablar con alguien

Reservar turno → mensaje con botón "Reservar turno" → formulario nativo de WhatsApp:
  1. Tu lavado: ¿1 o 2 vehículos?, tipo, servicio, extras
  2. 2do vehículo (solo si eligió 2; el más barato con 20% OFF)
  3. ¿Dónde lavamos?: nombre, calle o barrio cerrado + lote (cobertura validada acá)
  4. Día y pago: día, horario (disponibilidad real para la duración total), forma de pago,
     código de descuento (validado acá, con el motivo si no sirve)
  5. Resumen con el total exacto → "Confirmar reserva"
→ el bot crea la reserva y responde:
  · Mercado Pago: imagen con QR + link de pago + alias. "Apenas se acredite te mandamos la
    confirmación y la factura."
  · Transferencia: datos bancarios + pedido de comprobante
  · Pago el día del lavado: reserva confirmada
→ Pago acreditado (webhook de MP o comprobante aprobado en el admin) → mensaje automático
  "¡Recibimos tu pago y tu reserva quedó confirmada!" con servicio, fecha, dirección y link
  a la factura.
→ 4 h después de que el operador marca el lavado como terminado → plantilla
  "¿Cómo quedó tu auto?" [¡Todo excelente!] [Podría mejorar]
  · Excelente → link para dejar reseña en Google
  · Podría mejorar → "Contanos qué pasó" → el comentario queda guardado y la conversación
    pasa a /admin/mensajes para que el equipo responda
```

Además:
- **Reacciones** (👍 a un mensaje del bot): se ignoran, sin respuesta y sin cambiar el estado.
- **"gracias", "ok genial", "dale gracias", "👍"...**: cierre amable ("¡Gracias a vos, Pedro! 🙌…").
  Un segundo "gracias" no recibe respuesta (sin ping-pong). En medio de una reserva o esperando
  un comprobante, responde "¡De nada!" sin perder lo que el cliente venía haciendo.
- **"no promos"**: baja de promociones en cualquier momento.
- Si el formulario no está configurado (`WA_BOOKING_FLOW_ID` vacío) el bot usa el flujo
  anterior paso a paso, así que se puede desplegar el router antes que el formulario.

## Qué cambió en el código

| Pieza | Archivo |
|---|---|
| Máquina de estados (router n8n) | `scripts/n8n-washero-flow-router.js` (+ tests `.test.mjs`) |
| Normalize Inbound (lee el formulario, reacciones) | `scripts/n8n-washero-normalize-inbound.js` |
| Formulario (JSON de Meta) | `supabase/functions/_shared/whatsapp-booking-flow.json` |
| Lógica de pantallas del formulario | `supabase/functions/_shared/whatsapp-booking-flow.ts` (+ tests) |
| Endpoint cifrado del formulario | `supabase/functions/whatsapp-booking-flow/` + `_shared/whatsapp-flow-crypto.ts` (+ tests) |
| Tools nuevos del bot | `_shared/whatsapp-bot-v2-tools.ts` (registrados en `whatsapp-tools`) |
| QR de Mercado Pago | `supabase/functions/payment-qr/` + `_shared/payment-qr.ts`; `get_payment_link` ahora devuelve `qr_image_url` y `mp_alias` |
| Comprobantes del alias de MP | `_shared/payment-receipts.ts` acepta reservas MercadoPago además de Transferencia |
| Mensaje "pago recibido = reserva confirmada + factura" | `_shared/whatsapp-automation.ts` |
| Encuesta | `supabase/functions/send-satisfaction-surveys/` + `_shared/satisfaction-survey.ts` (+ tests), cron en `supabase/optional/satisfaction_survey_schedule.sql` |
| Base de datos | `supabase/migrations/20261115120000_whatsapp_bot_v2.sql` |
| Alta del formulario en Meta | `scripts/whatsapp-flow-setup.mjs` |

## Despliegue (en este orden)

1. **Migración** `20261115120000_whatsapp_bot_v2.sql` (tablas `whatsapp_booking_form_sessions`,
   `booking_satisfaction_surveys`, nuevo origen de consentimiento `whatsapp_welcome_notice`).
2. **Secretos de Supabase**
   - `MERCADOPAGO_ALIAS` (si no está, usa `WASHERO_TRANSFER_ALIAS`)
   - `GOOGLE_REVIEW_URL` (link de reseña de Google Business)
   - `PAYMENT_QR_SECRET` (opcional; si falta firma con la service role key)
   - `SURVEY_INTERNAL_SECRET` (o se reutiliza `PUSH_INTERNAL_SECRET`)
   - `WA_APP_SECRET` (opcional, verifica la firma de Meta en el endpoint del formulario)
3. **Edge functions**: `whatsapp-tools` (bundle: `node scripts/bundle-whatsapp-tools.mjs`),
   `payment-qr`, `whatsapp-booking-flow`, `send-satisfaction-surveys`, `mercadopago-webhook` y
   `approve-payment-receipt` (por el nuevo mensaje de pago confirmado).
4. **n8n**: pegar `n8n-washero-normalize-inbound.js` y `n8n-washero-flow-router.js` en los nodos
   Code del workflow. Con esto ya andan: reacciones, "gracias", bienvenida, menú nuevo, QR de MP
   y respuestas a la encuesta. Reservar sigue paso a paso hasta el paso 5.
5. **Formulario en Meta**
   ```
   node scripts/whatsapp-flow-setup.mjs keys
   supabase secrets set WA_FLOW_PRIVATE_KEY="$(cat dist/wa-flow-private.pem)"
   WA_TOKEN=… PHONE_NUMBER_ID=1128142377056954 node scripts/whatsapp-flow-setup.mjs upload-key
   WA_TOKEN=… WABA_ID=… node scripts/whatsapp-flow-setup.mjs create
   supabase secrets set WA_BOOKING_FLOW_ID=<id> WA_BOOKING_FLOW_MODE=draft
   WA_TOKEN=… FLOW_ID=<id> node scripts/whatsapp-flow-setup.mjs status   # sin validation_errors
   ```
   En modo `draft` el formulario sólo funciona para los números de prueba de la app de Meta:
   probarlo de punta a punta y después `publish` + `WA_BOOKING_FLOW_MODE=published`.
6. **Encuesta**: `POST send-satisfaction-surveys {"action":"submit_template"}`, esperar la
   aprobación de Meta, probar con `{"action":"dry_run"}` y recién ahí correr
   `supabase/optional/satisfaction_survey_schedule.sql`.

## A tener en cuenta

- **Aviso de promos en la bienvenida**: queda registrado como `opted_in` con origen
  `whatsapp_welcome_notice` y el texto exacto del aviso como evidencia. Es un esquema de
  "salida" (opt-out); la política de Meta pide consentimiento previo para mensajes de marketing,
  así que conviene que las campañas fuertes sigan pidiendo el "Sí, quiero promos" explícito.
  Nunca pisa una decisión anterior del cliente.
- **QR de Mercado Pago**: codifica el link de pago de la reserva (misma preferencia), así que un
  pago por QR o link se confirma solo vía `mercadopago-webhook` y dispara la factura. Un pago al
  **alias** no trae referencia: el cliente manda el comprobante y se aprueba desde el admin
  (después de aprobarlo, la confirmación y la factura también salen solas).
- **Encuesta**: la plantilla se envía como UTILITY; si Meta la recategoriza como MARKETING
  sigue funcionando, con otro costo.
