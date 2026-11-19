// ============================================================================
// Washero WhatsApp booking flow — deterministic state machine (no LLM).
// Pure function of (state, data, tapped button / typed text, tool results).
// Emits either { action: 'call' } or { action: 'reply' } with next_state.
// Location is locked (Places or barrio cerrado) before services/slots.
// ============================================================================
const norm = $('Normalize Inbound').first().json || {};
const inp = $input.first().json || {};

const to = String(norm.phone || '').replace(/^549/, '54');
const state0 = String(inp.state || 'none');
const data0 = (inp.data && typeof inp.data === 'object') ? inp.data : {};
const results = Array.isArray(inp.results) ? inp.results : [];

const rid = String(norm.reply_id || '');
const rtitle = String(norm.reply_title || '');
const mtype = String(norm.message_type || 'text');
const text = String(norm.message_text || '').trim();
const low = text.toLowerCase();
const mediaId = String(norm.media_id || '');
const lat = (typeof norm.lat === 'number' && Number.isFinite(norm.lat)) ? norm.lat : null;
const lng = (typeof norm.lng === 'number' && Number.isFinite(norm.lng)) ? norm.lng : null;
// WhatsApp Flow (booking form) submission: Normalize Inbound passes nfm_reply.response_json.
let flowResponse = null;
try {
  const fr = norm.flow_response;
  flowResponse = (fr && typeof fr === 'object') ? fr : (fr ? JSON.parse(String(fr)) : null);
} catch (e) { flowResponse = null; }
// Read the conversation flags from the Get Conversation State node itself: after a tool call,
// Collect Tool Result only forwards state/data/results, so $input loses them on later passes.
let convState = inp;
try {
  const g = $('Get Conversation State').first().json;
  if (g && typeof g === 'object') convState = g;
} catch (e) { convState = inp; }
// get_conversation_state answers exists:false for a phone that never wrote before.
const firstContact = convState.exists === false && state0 === 'none';
// promo_notice_pending: this contact has no promo preference yet (new or returning). The
// discreet notice is shown once in the next menu / form / prices message and recorded.
const noticePending = firstContact || convState.promo_notice_pending === true;

// Editable texts (/admin/whatsapp-config → whatsapp_bot_settings). get_conversation_state sends
// them as bot_texts; anything missing or empty keeps the built-in text below.
const T = {
  welcome: '¡Hola {nombre}! 👋 Soy el asistente de Washero.',
  menu_body: 'Lavado de autos a domicilio en Zona Norte 🚗💦\n\n¿Qué querés hacer?',
  promo_notice: '📣 Agendamos tu número para avisarte de promos y descuentos. Si preferís no recibirlas, escribí *no promos* y listo.',
  thanks: '¡Gracias a vos, {nombre}! 🙌 Cualquier cosa escribinos por acá cuando quieras. ¡Que tengas un lindo día! 🚗💦',
  miss: 'Perdón, no te entendí 🤔 Tocá una de las opciones:',
  handoff: 'Ya avisé a alguien del equipo 🙌 Te escriben por acá en breve.',
  form_body: 'Completá el formulario y tu turno queda reservado en menos de 1 minuto ⏱️\n\nAhí elegís servicio, vehículo (el 2do auto tiene 20% OFF), dirección, día y horario, forma de pago y tu código de descuento si tenés uno.',
  info_footer: '🚗🚙 *2 autos en la misma visita: 20% OFF en el más barato.*\nEl precio final depende del vehículo y los extras.',
  survey_good: '¡Qué bueno! Nos alegra un montón 🙌',
  survey_bad: 'Gracias por avisarnos, lamentamos que no haya salido perfecto 😔\n\nContanos por acá qué pasó o qué podemos mejorar. Lo lee el equipo directamente.',
  feedback_thanks: 'Gracias por contarnos 🙏 Ya se lo pasé al equipo para mejorar. Si hace falta, te escriben por acá.'
};
if (convState.bot_texts && typeof convState.bot_texts === 'object') {
  Object.keys(T).forEach(function (k) {
    const v = convState.bot_texts[k];
    if (typeof v === 'string' && v.trim()) T[k] = v.trim();
  });
}
// "{nombre}" → first name; without a name it disappears with its leading space / comma.
function withName(s, nm) {
  return String(s).replace(/[ ,]*\{nombre\}/g, function (m) { return nm ? m.replace('{nombre}', nm) : ''; });
}

const MAX_TOOL_CALLS = 10;
const FALLBACK_VEHICLES = ['Auto', 'SUV', 'Pick-up', 'Otro'];

function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function money(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR'); }
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDate(iso) {
  const p = String(iso || '').split('-');
  if (p.length !== 3) return String(iso || '');
  const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return DIAS[d.getUTCDay()] + ' ' + Number(p[2]) + ' ' + MESES[Number(p[1]) - 1];
}
function fmtTime(t) { return String(t || '').slice(0, 5); }

function msgText(body) {
  return { payload: { messaging_product: 'whatsapp', to: to, type: 'text', text: { preview_url: true, body: cut(body, 3500) } }, log_text: body };
}
function msgButtons(body, btns, header) {
  const bs = btns.slice(0, 3).map(function (b) { return { type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } }; });
  const inter = { type: 'button', body: { text: cut(body, 1024) }, action: { buttons: bs } };
  if (header) inter.header = { type: 'text', text: cut(header, 60) };
  const log = body + '\n' + bs.map(function (b) { return '[' + b.reply.title + ']'; }).join(' ');
  return { payload: { messaging_product: 'whatsapp', to: to, type: 'interactive', interactive: inter }, log_text: log };
}
function msgList(body, buttonLabel, rows, header, sectionTitle) {
  const rs = rows.slice(0, 10).map(function (r) {
    const o = { id: cut(r.id, 200), title: cut(r.title, 24) };
    if (r.description) o.description = cut(r.description, 72);
    return o;
  });
  const inter = { type: 'list', body: { text: cut(body, 1024) }, action: { button: cut(buttonLabel || 'Ver opciones', 20), sections: [{ title: cut(sectionTitle || 'Opciones', 24), rows: rs }] } };
  if (header) inter.header = { type: 'text', text: cut(header, 60) };
  const log = body + '\n' + rs.map(function (r) { return '- ' + r.title; }).join('\n');
  return { payload: { messaging_product: 'whatsapp', to: to, type: 'interactive', interactive: inter }, log_text: log };
}

function msgImage(link, caption) {
  return { payload: { messaging_product: 'whatsapp', to: to, type: 'image', image: { link: link, caption: cut(caption, 1024) } }, log_text: '[QR de pago]\n' + caption };
}
function msgFlow(body, cta, flow, header, footer) {
  const params = {
    flow_message_version: '3',
    flow_token: flow.flow_token,
    flow_id: flow.flow_id,
    flow_cta: cut(cta, 20),
    flow_action: 'data_exchange'
  };
  if (flow.mode === 'draft') params.mode = 'draft';
  const inter = { type: 'flow', body: { text: cut(body, 1024) }, action: { name: 'flow', parameters: params } };
  if (header) inter.header = { type: 'text', text: cut(header, 60) };
  if (footer) inter.footer = { text: cut(footer, 60) };
  return { payload: { messaging_product: 'whatsapp', to: to, type: 'interactive', interactive: inter }, log_text: body + '\n[' + cta + ']' };
}

function callTool(tool, args) {
  return [{ json: { action: 'call', tool: tool, args: args || {}, state: state0, data: data0, results: results } }];
}
function reply(nextState, nextData, msg) {
  nextData = nextData || {};
  if (data0.after_hours_at && !nextData.after_hours_at) nextData.after_hours_at = data0.after_hours_at;
  return [{ json: {
    action: 'reply',
    next_state: nextState,
    next_data: nextData || {},
    payload: msg ? msg.payload : null,
    log_text: msg ? msg.log_text : '',
    has_message: msg ? true : false
  } }];
}
function byTool(name) {
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] && results[i].tool === name) return results[i].result;
  }
  return null;
}
function ridVal(prefix) { return rid.indexOf(prefix + ':') === 0 ? rid.slice(prefix.length + 1) : null; }
function extrasList(data) { return Array.isArray(data.selected_extras) ? data.selected_extras.slice() : []; }
function slotArgs(data) {
  return {
    service_id: data.service_id,
    vehicle_type: data.vehicle_type || 'Auto',
    selected_extras: extrasList(data)
  };
}

const MENU_ROWS = [
  { id: 'menu:reservar', title: 'Reservar turno', description: 'Formulario rápido, menos de 1 minuto' },
  { id: 'menu:reservas', title: 'Mis reservas', description: 'Ver, reprogramar o cancelar' },
  { id: 'menu:info', title: 'Precios y zonas', description: 'Servicios, precios y cobertura' },
  { id: 'menu:humano', title: 'Hablar con alguien', description: 'Te responde una persona del equipo' }
];
const NO_PROMOS_ROW = { id: 'menu:nopromos', title: 'No recibir promos', description: 'No te mandamos ofertas' };
const WELCOME_NOTICE = T.promo_notice;
function firstNameOf(full) { return String(full || '').trim().split(/\s+/)[0] || ''; }
function menuMsg(prefix, header, withNoPromos, suffix) {
  const body = (prefix || '') + T.menu_body + (suffix || '');
  const rows = withNoPromos ? MENU_ROWS.concat([NO_PROMOS_ROW]) : MENU_ROWS;
  return msgList(body, 'Ver opciones', rows, header || 'Washero', 'Menu principal');
}

const STEP_OF_STATE = {
  menu: 'MENU', addrtype: 'ADDRTYPE', street: 'STREET', streetpick: 'STREET',
  streetconfirm: 'STREETCONFIRM', privlist: 'PRIVLIST', privlot: 'PRIVLOT',
  outside: 'OUTSIDE', svc: 'SVC', veh: 'VEH', extras: 'EXTRAS', name: 'NAME',
  date: 'DATE', time: 'TIME', pay: 'PAY', confirm: 'CONFIRM', form: 'FORM',
  await_receipt: 'WAITPAY', feedback: 'FEEDBACK_ASK', mybk: 'MYBK', bkact: 'BKACT', rdate: 'RDATE',
  rtime: 'RTIME', cxlconf: 'CXLCONF'
};
// Quick replies of WhatsApp marketing templates. whatsapp-tools ingest_message already
// stored the consent; here we only acknowledge and leave the customer in the menu.
const promoReply = low.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isPromoOptIn = mtype === 'button' && promoReply === 'si, quiero promos';
const isPromoOptOut = mtype === 'button' && promoReply === 'no recibir promos';
const isMenuCmd = rid === 'nav:menu' || /^(menu|menú|hola|holaa+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|inicio|volver|empezar|start)[!. ]*$/i.test(low);
const folded = promoReply;
const isNoPromosCmd = rid === 'menu:nopromos' || /^(no (quiero )?(recibir )?(promos|promociones|ofertas)|baja|stop)[!. ]*$/.test(folded);
const BOOK_TEXT_RE = /\b(reservar|reserva(r)? (un )?turno|quiero (un )?turno|sacar (un )?turno|agendar|quiero (un )?lavado|quiero lavar)/;
const INFO_TEXT_RE = /\b(precio|precios|cuanto (sale|cuesta|esta|cobran)|tarifa|zona|zonas|cobertura|llegan)/;
// "gracias", "ok genial", "dale, muchas gracias!", "👍"... A short message made only of
// courtesy words closes the chat politely instead of the "no te entendí" fallback.
const COURTESY_WORDS = ['gracias', 'grasias', 'gracia', 'grax', 'tks', 'thanks', 'mil', 'muchas', 'muchisimas', 'genial',
  'perfecto', 'perfect', 'buenisimo', 'barbaro', 'joya', 'excelente', 'dale', 'ok', 'okey', 'oka', 'okis', 'listo',
  'chau', 'saludos', 'abrazo', 'igualmente', 'bueno', 'buen', 'dia', 'tarde', 'noche', 'que', 'tengas', 'tengan',
  'lindo', 'un', 'vos', 'a', 'de', 'nada', 'super', 're', 'todo', 'bien', 'entendido', 'vale', 'no', 'si', 'besos',
  'q', 'muy', 'amable', 'amables', 'por', 'la', 'info', 'informacion', 'ayuda', 'atencion', 'hasta', 'luego', 'pronto'];
const CLOSING_RE = /^(gra+c+i+a+s*|grasias|grax|tks|thanks|genial|perfecto|perfect|buenisimo|barbaro|joya|excelente|o+k+|okey|oka|okis|listo|chau|saludos|da+le+|entendido|vale|igualmente|super|amables?)$/;
function isCourtesy() {
  if (mtype !== 'text' || !text) return false;
  const cleaned = folded.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return /^[\s\p{Extended_Pictographic}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}!.]+$/u.test(text);
  const words = cleaned.split(' ');
  if (words.length > 10) return false;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (COURTESY_WORDS.indexOf(w) < 0 && !CLOSING_RE.test(w) && !/^(ja|je)+$/.test(w)) return false;
  }
  return words.some(function (w) { return CLOSING_RE.test(w); });
}
const isThanks = isCourtesy();
// States where the customer is mid-booking: a courtesy reply keeps the draft alive.
const MID_FLOW_STATES = ['addrtype', 'street', 'streetpick', 'streetconfirm', 'privlist', 'privlot', 'outside',
  'svc', 'veh', 'extras', 'name', 'date', 'time', 'pay', 'confirm', 'form', 'mybk', 'bkact', 'rdate', 'rtime', 'cxlconf'];
const isHumanCmd = rid === 'nav:humano';
const isReceiptMedia = mtype === 'image' || mtype === 'document';
const receipt = (inp.receipt_capture && typeof inp.receipt_capture === 'object')
  ? inp.receipt_capture
  : byTool('ingest_receipt');
const capturedOutcome = receipt && receipt.outcome ? String(receipt.outcome) : '';
const receiptAck = capturedOutcome === 'pending_review' || capturedOutcome === 'unresolved' || capturedOutcome === 'duplicate';
const receiptContinue = capturedOutcome === 'not_eligible' || capturedOutcome === 'unsupported_media';

let step = 'MENU';
let prefix = '';
let data = JSON.parse(JSON.stringify(data0));

// Reactions (👍 on a bot message) are not messages to answer: stay silent, keep state.
if (mtype === 'reaction') return reply(state0, data0, null);

if (convState.after_hours === true && !flowResponse && !/^survey:/.test(rid)) {
  const lastNotice = Date.parse(String(data0.after_hours_at || ''));
  if (!(Number.isFinite(lastNotice) && Date.now() - lastNotice < 12 * 3600 * 1000)) {
    const ahData = JSON.parse(JSON.stringify(data0));
    ahData.after_hours_at = new Date().toISOString();
    const ahMsg = String(convState.after_hours_message || '').trim() || 'Ahora estamos fuera de horario. Te respondemos apenas volvamos 🙌';
    return reply(state0, ahData, msgText(ahMsg));
  }
}

const surveyMatch = /^survey:(good|bad):(.+)$/.exec(rid);

if (isPromoOptIn) {
  step = 'MENU';
  data = { misses: 0 };
  prefix = '¡Listo! Te vamos a avisar por acá cuando haya promos 🙌\n\n';
} else if (isPromoOptOut) {
  return reply('none', { misses: 0 }, msgText('Listo, no te vamos a mandar más promociones. Si necesitás algo, escribí *menu* 👋'));
} else if (surveyMatch) {
  step = surveyMatch[1] === 'good' ? 'SURVEY_GOOD' : 'SURVEY_BAD';
  data = { misses: 0, survey_booking_id: surveyMatch[2] };
} else if (flowResponse && results.length < MAX_TOOL_CALLS) {
  step = 'FORM_DONE';
} else if (results.length >= MAX_TOOL_CALLS) {
  step = 'HANDOFF';
  data.handoff_reason = 'flujo n8n: demasiados pasos internos en un turno';
} else if (state0 === 'handoff' && !isMenuCmd) {
  return reply('handoff', data0, null);
} else if (isHumanCmd) {
  step = 'HANDOFF';
  data.handoff_reason = 'el cliente pidio hablar con una persona';
} else if (isMenuCmd) {
  step = 'MENU';
  data = { misses: 0 };
} else if (isNoPromosCmd) {
  step = 'NOPROMOS';
  data = { misses: 0 };
} else if (isThanks && state0 !== 'feedback') {
  if (state0 === 'closed') return reply('closed', data0, null);
  if (state0 === 'await_receipt') {
    return reply('await_receipt', data0, msgText('¡De nada! 🙌 Cuando tengas el comprobante, mandalo por acá y lo revisamos.'));
  }
  if (MID_FLOW_STATES.indexOf(state0) >= 0) {
    return reply(state0, data0, msgText('¡De nada! 🙌 Seguimos cuando quieras: tocá una opción del último mensaje o escribí *menu* para empezar de nuevo.'));
  }
  step = 'THANKS';
} else if (receiptAck) {
  step = 'RECEIPT_ACK';
} else if (data0.awaiting_receipt && isReceiptMedia && !receiptContinue) {
  step = 'RECEIPT';
} else if (isReceiptMedia && !receiptContinue && capturedOutcome !== 'capture_error') {
  step = 'RECEIPT';
} else if (capturedOutcome === 'capture_error') {
  step = 'HANDOFF';
  data.handoff_reason = 'no se pudo guardar el comprobante de transferencia';
} else if (receiptContinue && data0.awaiting_receipt) {
  step = 'WAITPAY';
  prefix = 'Cuando tengas el comprobante, mandame la foto o el PDF por acá.\n\n';
} else if (mtype === 'location') {
  if (lat != null && lng != null) {
    data.address_type = 'street';
    data.lat = lat;
    data.lng = lng;
    data.need_confirm = true;
    data.misses = 0;
    step = 'VALIDATE';
  } else {
    step = 'MISS';
  }
} else if (mtype === 'button') {
  // Any other template button (e.g. "Reservar" quick reply): show the menu.
  step = 'MENU';
  data = { misses: 0 };
} else if (mtype !== 'text' && mtype !== 'interactive') {
  step = 'MISS';
  prefix = 'Por ahora no puedo procesar ese tipo de mensaje 🙅‍♂️\n\n';
} else {
  switch (state0) {
    case 'menu': {
      const v = ridVal('menu');
      if (v === 'reservar') { step = 'FORM'; data = { misses: 0 }; }
      else if (v === 'info' || v === 'servicios' || v === 'zonas') { step = 'INFO'; data.misses = 0; }
      else if (v === 'reservas') { step = 'MYBK'; data.misses = 0; }
      else if (v === 'humano') { step = 'HANDOFF'; data.handoff_reason = 'el cliente pidio hablar con una persona'; }
      else if (!rid && BOOK_TEXT_RE.test(folded)) { step = 'FORM'; data = { misses: 0 }; }
      else if (!rid && INFO_TEXT_RE.test(folded)) { step = 'INFO'; data.misses = 0; }
      else step = 'MISS';
      break;
    }
    case 'form': {
      // The booking form is open on the customer's phone; typed text means they're lost.
      if (rid === 'form:legacy') { step = 'ADDRTYPE'; data = { misses: 0 }; }
      else { step = 'MISS'; prefix = 'Para reservar tocá *Reservar turno* y completá el formulario 👇\n\n'; }
      break;
    }
    case 'feedback': {
      if (text.length >= 2 && !rid) { data.feedback_text = text; data.misses = 0; step = 'FEEDBACK_SAVE'; }
      else step = 'MISS';
      break;
    }
    case 'addrtype': {
      const v = ridVal('at');
      if (v === 'street') { data.address_type = 'street'; data.misses = 0; step = 'STREET'; }
      else if (v === 'priv') { data.address_type = 'private_neighborhood'; data.misses = 0; step = 'PRIVLIST'; }
      else step = 'MISS';
      break;
    }
    case 'street': {
      if (text.length >= 4) { data.address_raw = text; data.place_id = ''; data.misses = 0; step = 'SUGGEST'; }
      else { step = 'MISS'; prefix = 'Necesito la dirección un poco más completa 🙏\n\n'; }
      break;
    }
    case 'streetpick': {
      const v = ridVal('sug');
      if (v === 'none') { data.need_confirm = true; data.place_id = ''; data.misses = 0; step = 'VALIDATE'; }
      else if (v === 'retype') { data.misses = 0; step = 'STREET'; }
      else if (v) { data.place_id = v; data.need_confirm = false; data.misses = 0; step = 'VALIDATE'; }
      else step = 'MISS';
      break;
    }
    case 'streetconfirm': {
      const v = ridVal('cf');
      if (v === 'yes') { data.need_confirm = false; data.misses = 0; prefix = 'Dirección confirmada, estamos en zona ✅\n\n'; step = 'SVC'; }
      else if (v === 'no') { data.place_id = ''; data.address_raw = ''; data.misses = 0; step = 'STREET'; }
      else step = 'MISS';
      break;
    }
    case 'privlist': {
      const v = ridVal('priv');
      if (v) { data.private_neighborhood_id = v; data.private_neighborhood_name = rtitle || data.private_neighborhood_name; data.misses = 0; step = 'PRIVLOT'; }
      else step = 'MISS';
      break;
    }
    case 'privlot': {
      if (text.length >= 1) { data.private_lot = text; data.misses = 0; step = 'VALIDATE'; }
      else step = 'MISS';
      break;
    }
    case 'outside': {
      const v = ridVal('out');
      if (v === 'retry' || ridVal('at')) { data = { misses: 0 }; step = 'ADDRTYPE'; }
      else if (v === 'human') { step = 'HANDOFF'; data.handoff_reason = 'fuera de cobertura, el cliente pidio una persona'; }
      else step = 'MISS';
      break;
    }
    case 'svc': {
      const v = ridVal('svc');
      if (v) { data.service_id = v; data.service_name = rtitle || data.service_name || ''; data.misses = 0; step = 'VEH'; }
      else step = 'MISS';
      break;
    }
    case 'veh': {
      const v = ridVal('veh');
      if (v) { data.vehicle_type = v; data.misses = 0; step = 'EXTRAS'; }
      else step = 'MISS';
      break;
    }
    case 'extras': {
      const v = ridVal('ex');
      if (v === 'none') { data.selected_extras = []; data.misses = 0; step = 'NAME'; }
      else if (v === 'done') { data.misses = 0; step = 'NAME'; }
      else if (v) {
        const cur = extrasList(data);
        if (cur.indexOf(v) < 0) cur.push(v);
        data.selected_extras = cur;
        data.misses = 0;
        step = 'EXTRAS';
      } else step = 'MISS';
      break;
    }
    case 'name': {
      if (text.length >= 2 && !rid) { data.customer_name = text; data.misses = 0; step = 'DATE'; }
      else step = 'MISS';
      break;
    }
    case 'date': {
      const v = ridVal('date');
      if (v) { data.scheduled_date = v; data.misses = 0; step = 'TIME'; }
      else step = 'MISS';
      break;
    }
    case 'time': {
      const v = ridVal('time');
      if (v === 'back') { data.misses = 0; step = 'DATE'; }
      else if (v) { data.scheduled_time = v; data.misses = 0; step = 'PAY'; }
      else step = 'MISS';
      break;
    }
    case 'pay': {
      const v = ridVal('pay');
      if (v === 'mp') { data.payment_method = 'MercadoPago'; data.misses = 0; step = 'CONFIRM'; }
      else if (v === 'tr') { data.payment_method = 'Transferencia'; data.misses = 0; step = 'CONFIRM'; }
      else if (v === 'later') { data.payment_method = 'Pagar después'; data.misses = 0; step = 'CONFIRM'; }
      else step = 'MISS';
      break;
    }
    case 'confirm': {
      const v = ridVal('cf');
      if (v === 'yes') { data.misses = 0; step = 'CREATE'; }
      else if (v === 'no') { step = 'MENU'; data = { misses: 0 }; prefix = 'Listo, descarte esa reserva ✅\n\n'; }
      else step = 'MISS';
      break;
    }
    case 'await_receipt': {
      if (isReceiptMedia && receiptContinue) {
        step = 'WAITPAY';
        prefix = 'Cuando tengas el comprobante, mandame la foto o el PDF por acá.\n\n';
      } else if (isReceiptMedia) step = 'RECEIPT';
      else { step = 'WAITPAY'; prefix = 'Cuando tengas el comprobante, mandame la foto o el PDF por acá.\n\n'; }
      break;
    }
    case 'mybk': {
      const v = ridVal('bk');
      if (v) { data.sel_booking_id = v; data.misses = 0; step = 'BKACT'; }
      else step = 'MISS';
      break;
    }
    case 'bkact': {
      const v = ridVal('act');
      if (v === 'resched') { data.misses = 0; step = 'RDATE'; }
      else if (v === 'cancel') { data.misses = 0; step = 'CXLCONF'; }
      else if (v === 'back') { data.misses = 0; step = 'MYBK'; }
      else step = 'MISS';
      break;
    }
    case 'rdate': {
      const v = ridVal('date');
      if (v) { data.new_date = v; data.misses = 0; step = 'RTIME'; }
      else step = 'MISS';
      break;
    }
    case 'rtime': {
      const v = ridVal('time');
      if (v) { data.new_time = v; data.misses = 0; step = 'RESCHED'; }
      else step = 'MISS';
      break;
    }
    case 'cxlconf': {
      const v = ridVal('cf');
      if (v === 'yes') { data.misses = 0; step = 'DOCANCEL'; }
      else if (v === 'no') { data.misses = 0; step = 'BKACT'; }
      else step = 'MISS';
      break;
    }
    default: {
      // none / closed / unknown: jump straight to what the customer typed when it's obvious.
      data = { misses: 0 };
      if (!rid && BOOK_TEXT_RE.test(folded)) step = 'FORM';
      else if (!rid && INFO_TEXT_RE.test(folded)) step = 'INFO';
      else step = 'MENU';
    }
  }
}

if (step === 'MISS') {
  const m = (Number(data.misses) || 0) + 1;
  data.misses = m;
  if (m >= 3) {
    step = 'HANDOFF';
    data.handoff_reason = 'el cliente escribio 3 veces algo que el flujo por botones no reconoce';
  } else {
    step = STEP_OF_STATE[state0] || 'MENU';
    prefix = prefix || T.miss + '\n\n';
  }
}

function fail(msg) {
  return reply('menu', { misses: 0 }, msgList(msg + '\n\n¿Qué querés hacer?', 'Ver opciones', MENU_ROWS, 'Washero', 'Menu principal'));
}

function lockFromValidate(v) {
  data.address = v.formatted_address || data.address_raw || data.private_neighborhood_name || '';
  data.formatted_address = v.formatted_address || data.address;
  data.neighborhood = v.neighborhood || v.coverage_zone_name || data.address;
  data.address_lat = v.address_lat;
  data.address_lng = v.address_lng;
  data.place_id = v.place_id || data.place_id || '';
  data.coverage_zone_id = v.coverage_zone_id;
  data.coverage_zone_name = v.coverage_zone_name;
  if (v.private_neighborhood_id) data.private_neighborhood_id = v.private_neighborhood_id;
  if (v.private_neighborhood_name) data.private_neighborhood_name = v.private_neighborhood_name;
}

function noticeSuffix() { return noticePending ? '\n\n_' + WELCOME_NOTICE + '_' : ''; }

function bookedSummary(bk, lines) {
  let s = '';
  const units = (lines && lines.length) ? lines
    : [(bk.service_name || data.service_name || '-') + ' — ' + (bk.vehicle_type || data.vehicle_type || '')];
  units.forEach(function (l) { s += '• ' + l + '\n'; });
  s += '• ' + fmtDate(bk.scheduled_date || data.scheduled_date) + ' a las ' + fmtTime(bk.scheduled_time || data.scheduled_time) + ' hs\n';
  s += '• ' + (bk.address || data.formatted_address || data.address || '') + '\n';
  s += '• Total: *' + money(bk.price != null ? bk.price : data.price) + '*\n';
  return s;
}

// Post-booking message, shared by the form and the legacy step-by-step flow.
function renderPayment(bk, method, lines) {
  const nm = firstNameOf(bk.customer_name || data.customer_name || norm.name);
  const hi = '¡Listo' + (nm ? ', ' + nm : '') + '! ';
  const summary = bookedSummary(bk, lines);
  if (method === 'MercadoPago') {
    const pl = byTool('get_payment_link');
    if (!pl) return callTool('get_payment_link', { booking_id: bk.id });
    const opts = [];
    if (pl.ok && pl.qr_image_url) opts.push('Escaneá este QR desde la app de Mercado Pago.');
    if (pl.ok && pl.checkout_url) opts.push('O pagá desde este link: ' + pl.checkout_url);
    if (pl.mp_alias) opts.push('O transferí al alias *' + pl.mp_alias + '* y mandanos el comprobante por acá.');
    let pay = '💳 *Para confirmar el turno, pagá con Mercado Pago:*\n';
    if (!opts.length) pay = 'En un rato te mandamos los datos para pagar.\n';
    else opts.forEach(function (o) { pay += '• ' + o + '\n'; });
    const body = hi + 'Tu turno quedó reservado 🙌\n\n' + summary + '\n' + pay +
      '\nApenas se acredite el pago te mandamos la confirmación y la factura 🧾';
    const st = pl.mp_alias ? 'await_receipt' : 'none';
    const next = { misses: 0, booking_id: bk.id, awaiting_receipt: !!pl.mp_alias };
    if (pl.ok && pl.qr_image_url && body.length <= 1024) return reply(st, next, msgImage(pl.qr_image_url, body));
    return reply(st, next, msgText(body));
  }
  if (method === 'Transferencia') {
    const bank = byTool('get_bank_transfer_details');
    if (!bank) return callTool('get_bank_transfer_details', { booking_id: bk.id });
    const how = (bank.ok && bank.customer_message) ? bank.customer_message
      : 'Te pasamos los datos para transferir. Respondé con la foto o PDF del comprobante.';
    const body = hi + 'Tu turno quedó reservado 🙌\n\n' + summary + '\n' + how +
      '\n\nApenas validemos el pago te mandamos la confirmación y la factura 🧾';
    return reply('await_receipt', { misses: 0, booking_id: bk.id, awaiting_receipt: true }, msgText(body));
  }
  const body = hi + 'Tu turno quedó confirmado ✅\n\n' + summary + '\nPagás el día del lavado. Te avisamos cuando el equipo esté en camino 🚗💦';
  return reply('none', { misses: 0 }, msgText(body));
}

function render(st) {
  switch (st) {
    case 'MENU': {
      if (noticePending) {
        const n = byTool('record_marketing_notice');
        if (!n) return callTool('record_marketing_notice', {});
        const nm = firstNameOf(norm.name);
        const greet = firstContact ? withName(T.welcome, nm) + '\n\n' : '';
        return reply('menu', { misses: 0 }, menuMsg(greet + prefix, null, true, noticeSuffix()));
      }
      return reply('menu', { misses: Number(data.misses) || 0 }, menuMsg(prefix));
    }

    case 'THANKS': {
      const nm = firstNameOf(norm.name);
      return reply('closed', { misses: 0 }, msgText(withName(T.thanks, nm)));
    }

    case 'NOPROMOS': {
      const r = byTool('set_marketing_consent');
      if (!r) return callTool('set_marketing_consent', { consent: 'opt_out' });
      return reply('menu', { misses: 0 }, menuMsg('Listo, no te vamos a mandar promociones 👍\n\n'));
    }

    case 'INFO': {
      if (noticePending) {
        const n = byTool('record_marketing_notice');
        if (!n) return callTool('record_marketing_notice', {});
      }
      const r = byTool('get_services');
      if (!r) return callTool('get_services', {});
      const z = byTool('list_coverage_zones');
      if (!z) return callTool('list_coverage_zones', {});
      if (!r.ok) return fail('No pude traer los precios ahora 😓');
      let body = 'Nuestros servicios 🧼\n\n';
      (r.services || []).forEach(function (s) {
        body += '• *' + s.name + '* — desde ' + money(s.base_price) + '\n';
        if (s.description) body += '  ' + s.description + '\n';
      });
      body += '\n' + T.info_footer;
      if (z.ok) {
        body += '\n\n📍 Llegamos a: ' + (z.zones || []).join(', ');
        if ((z.private_neighborhoods || []).length) body += '\n🏡 Barrios cerrados: ' + z.private_neighborhoods.join(', ');
      }
      body += '\n\n¿Qué querés hacer?' + noticeSuffix();
      return reply('menu', { misses: 0 }, msgList(body, 'Ver opciones', MENU_ROWS, 'Precios y zonas', 'Menu principal'));
    }

    case 'FORM': {
      if (noticePending) {
        const n = byTool('record_marketing_notice');
        if (!n) return callTool('record_marketing_notice', {});
      }
      const f = byTool('start_booking_form');
      if (!f) return callTool('start_booking_form', {});
      if (!f.ok || !f.flow_id || !f.flow_token) {
        // Form not configured / unavailable: fall back to the step-by-step booking.
        data = { misses: 0 };
        return render('ADDRTYPE');
      }
      const body = prefix + T.form_body + noticeSuffix();
      return reply('form', { misses: Number(data.misses) || 0, flow_token: f.flow_token },
        msgFlow(body, 'Reservar turno', f, 'Reservá tu lavado 🚗💦', 'Washero · Lavado a domicilio'));
    }

    case 'FORM_DONE': {
      const cb = byTool('create_booking_from_form');
      if (!cb) return callTool('create_booking_from_form', {
        flow_token: String(flowResponse.flow_token || ''),
        confirmation_message_id: norm.external_message_id || ''
      });
      if (!cb.ok) {
        data = { misses: 0 };
        if (['slot_unavailable', 'no_capacity', 'slot_full', 'slot_not_found', 'service_does_not_fit_slot', 'past_date'].indexOf(cb.reason) >= 0) {
          prefix = 'Uy, justo se ocupó ese horario 😓 Abrí el formulario de nuevo y elegí otro:\n\n';
          return render('FORM');
        }
        if (cb.reason === 'form_expired' || cb.reason === 'form_not_found' || cb.reason === 'form_incomplete') {
          prefix = 'Ese formulario ya venció. Abrilo de nuevo y en un minuto lo tenés 👇\n\n';
          return render('FORM');
        }
        if (cb.reason === 'invalid_discount_code') {
          prefix = (cb.message || 'El código de descuento ya no es válido.') + ' Abrí el formulario de nuevo:\n\n';
          return render('FORM');
        }
        if (cb.reason === 'outside_coverage' || cb.reason === 'not_in_coverage') {
          prefix = 'Esa dirección quedó fuera de nuestra zona 📍 Probá con otra:\n\n';
          return render('FORM');
        }
        data.handoff_reason = 'create_booking_from_form fallo: ' + (cb.reason || cb.message || 'desconocido');
        return render('HANDOFF');
      }
      const bk = cb.booking || {};
      return renderPayment(bk, bk.payment_method || cb.payment_method, cb.summary_lines || null);
    }

    case 'SURVEY_GOOD': {
      const r = byTool('record_survey_response');
      if (!r) return callTool('record_survey_response', { booking_id: data.survey_booking_id, rating: 'positive' });
      const link = r && r.review_url ? String(r.review_url) : '';
      const body = T.survey_good + '\n\n' +
        (link ? '¿Nos dejás una reseña en Google? Son 30 segundos y nos ayuda muchísimo 🙏\n' + link : '¡Gracias por elegirnos!') +
        '\n\n¡Hasta el próximo lavado! 🚗💦';
      return reply('closed', { misses: 0 }, msgText(body));
    }

    case 'SURVEY_BAD': {
      const r = byTool('record_survey_response');
      if (!r) return callTool('record_survey_response', { booking_id: data.survey_booking_id, rating: 'negative' });
      return reply('feedback', { misses: 0, feedback_booking_id: data.survey_booking_id }, msgText(T.survey_bad));
    }

    case 'FEEDBACK_ASK':
      return reply('feedback', data, msgText('Contanos en un mensaje qué pasó así lo mejoramos 🙏'));

    case 'FEEDBACK_SAVE': {
      const r = byTool('record_survey_response');
      if (!r) return callTool('record_survey_response', {
        booking_id: data.feedback_booking_id || '', rating: 'negative', comment: data.feedback_text || ''
      });
      const h = byTool('request_human_handoff');
      if (!h) return callTool('request_human_handoff', { reason: 'comentario de mejora tras la encuesta de satisfaccion' });
      return reply('handoff', { misses: 0 }, msgText(T.feedback_thanks));
    }

    case 'PRICES': {
      const r = byTool('get_services');
      if (!r) return callTool('get_services', {});
      if (!r.ok) return fail('No pude traer los precios ahora 😓');
      let body = 'Nuestros servicios 🧼\n\n';
      (r.services || []).forEach(function (s) {
        body += '• ' + s.name + ' — desde ' + money(s.base_price) + '\n';
        if (s.description) body += '  ' + s.description + '\n';
      });
      body += '\nEl precio final depende del vehículo y extras.\n\n¿Qué querés hacer?';
      return reply('menu', { misses: 0 }, msgList(body, 'Ver opciones', MENU_ROWS, 'Precios', 'Menu principal'));
    }

    case 'ZONES': {
      const r = byTool('list_coverage_zones');
      if (!r) return callTool('list_coverage_zones', {});
      if (!r.ok) return fail('No pude traer las zonas ahora 😓');
      let body = 'Zonas donde llegamos 📍\n\n' + (r.zones || []).join(', ');
      if ((r.private_neighborhoods || []).length) body += '\n\nBarrios privados: ' + r.private_neighborhoods.join(', ');
      body += '\n\n¿Qué querés hacer?';
      return reply('menu', { misses: 0 }, msgList(body, 'Ver opciones', MENU_ROWS, 'Cobertura', 'Menu principal'));
    }

    case 'ADDRTYPE': {
      const btns = [{ id: 'at:street', title: 'Calle / avenida' }, { id: 'at:priv', title: 'Barrio cerrado' }];
      return reply('addrtype', data, msgButtons(prefix + '¿Dónde lavamos? Primero decime si es calle o un barrio cerrado/country.', btns, 'Ubicación'));
    }

    case 'STREET': {
      return reply('street', data, msgText(prefix + 'Escribime tu dirección (calle, altura y localidad). Ej: _Av. del Libertador 1234, Martínez_\n\nTambién podés mandar tu ubicación de WhatsApp.'));
    }

    case 'SUGGEST': {
      const r = byTool('suggest_addresses');
      if (!r) return callTool('suggest_addresses', { query: data.address_raw });
      if (!r.ok || !(r.suggestions || []).length) {
        data.need_confirm = true;
        data.place_id = '';
        return render('VALIDATE');
      }
      const rows = r.suggestions.slice(0, 5).map(function (s, i) {
        return { id: 'sug:' + s.place_id, title: cut(s.main_text || s.description, 24), description: cut(s.secondary_text || s.description, 72) };
      });
      rows.push({ id: 'sug:none', title: 'Ninguna de estas', description: 'Usar el texto que escribí' });
      rows.push({ id: 'sug:retype', title: 'Reescribir', description: 'Probar otra dirección' });
      return reply('streetpick', data, msgList(prefix + 'Elegí la dirección 👇', 'Ver sugerencias', rows, 'Dirección', 'Sugerencias'));
    }

    case 'PRIVLIST': {
      const r = byTool('list_coverage_zones');
      if (!r) return callTool('list_coverage_zones', {});
      const list = r.private_neighborhood_list || (r.private_neighborhoods || []).map(function (n) { return { id: n, name: n }; });
      if (!list.length) return fail('No tengo barrios cerrados cargados ahora 😓');
      const rows = list.slice(0, 9).map(function (n) { return { id: 'priv:' + n.id, title: n.name }; });
      rows.push({ id: 'nav:humano', title: 'No está en la lista', description: 'Hablar con una persona' });
      return reply('privlist', data, msgList(prefix + 'Elegí el barrio cerrado 🏡', 'Ver barrios', rows, 'Barrio cerrado', 'Barrios'));
    }

    case 'PRIVLOT': {
      return reply('privlot', data, msgText(prefix + 'Anotado: *' + (data.private_neighborhood_name || 'tu barrio') + '*.\n\n¿Cuál es el lote / casa / manzana?'));
    }

    case 'VALIDATE': {
      const v = byTool('validate_service_area');
      if (!v) {
        const args = { address_type: data.address_type || 'street' };
        if (data.address_type === 'private_neighborhood') {
          args.private_neighborhood_id = data.private_neighborhood_id || '';
          args.private_neighborhood_name = data.private_neighborhood_name || data.address_raw || '';
        } else {
          if (data.place_id) args.place_id = data.place_id;
          if (data.address_raw) args.address = data.address_raw;
          if (data.lat != null && data.lng != null) { args.lat = data.lat; args.lng = data.lng; }
        }
        return callTool('validate_service_area', args);
      }
      if (!v.inside_coverage) {
        return reply('outside', { misses: 0, address_raw: data.address_raw }, msgButtons(
          'Todavía no llegamos a esa zona 📍\n\nPodés probar otra dirección o hablar con alguien del equipo.',
          [{ id: 'out:retry', title: 'Otra dirección' }, { id: 'out:human', title: 'Humano' }],
          'Fuera de cobertura'
        ));
      }
      lockFromValidate(v);
      if (data.need_confirm) {
        return reply('streetconfirm', data, msgButtons(
          '¿Es esta dirección?\n\n*' + (data.formatted_address || data.address) + '*',
          [{ id: 'cf:yes', title: 'Sí, es esta' }, { id: 'cf:no', title: 'No' }],
          'Confirmar dirección'
        ));
      }
      prefix = 'Dirección confirmada, estamos en zona ✅\n\n';
      return render('SVC');
    }

    case 'OUTSIDE':
      return reply('outside', { misses: Number(data.misses) || 0 }, msgButtons(
        prefix + 'Todavía no llegamos a esa zona. ¿Probamos otra dirección?',
        [{ id: 'out:retry', title: 'Otra dirección' }, { id: 'out:human', title: 'Humano' }],
        'Fuera de cobertura'
      ));

    case 'SVC': {
      const r = byTool('get_services');
      if (!r) return callTool('get_services', {});
      const svc = (r && r.services) || [];
      if (!svc.length) return fail('No pude traer los servicios ahora 😓');
      if (r.vehicle_types) data.vehicle_types = r.vehicle_types;
      if (r.extras) data.catalog_extras = r.extras;
      const rows = svc.map(function (s) { return { id: 'svc:' + s.id, title: s.name, description: 'desde ' + money(s.base_price) }; });
      return reply('svc', data, msgList(prefix + 'Elegí el servicio 👇', 'Ver servicios', rows, 'Paso 1 de 7', 'Servicios'));
    }

    case 'VEH': {
      const types = (data.vehicle_types && data.vehicle_types.length) ? data.vehicle_types : FALLBACK_VEHICLES;
      const rows = types.map(function (v) { return { id: 'veh:' + v, title: v }; });
      const body = prefix + 'Anotado: *' + (data.service_name || 'tu servicio') + '*.\n\n¿Qué tipo de vehículo es?';
      return reply('veh', data, msgList(body, 'Ver opciones', rows, 'Paso 2 de 7', 'Vehiculo'));
    }

    case 'EXTRAS': {
      const r = byTool('get_services');
      if (!r && !data.catalog_extras) return callTool('get_services', {});
      const extras = data.catalog_extras || (r && r.extras) || [];
      if (r && r.extras) data.catalog_extras = r.extras;
      if (!extras.length) return render('NAME');
      const chosen = extrasList(data);
      const remaining = extras.filter(function (e) { return chosen.indexOf(e.code) < 0; }).slice(0, 8);
      const rows = remaining.map(function (e) {
        return { id: 'ex:' + e.code, title: e.name, description: money(e.amount) };
      });
      if (chosen.length) rows.push({ id: 'ex:done', title: 'Listo, seguir', description: chosen.length + ' extra(s)' });
      else rows.push({ id: 'ex:none', title: 'Sin extras' });
      const body = prefix + (chosen.length
        ? 'Extras: *' + chosen.join(', ') + '*.\n¿Sumamos otro o seguimos?'
        : '¿Querés sumar algún extra?');
      return reply('extras', data, msgList(body, 'Ver extras', rows, 'Paso 3 de 7', 'Extras'));
    }

    case 'NAME': {
      const fromWa = String(norm.name || '').trim();
      if ((data.customer_name && String(data.customer_name).trim().length >= 2) || fromWa.length >= 2) {
        if (!data.customer_name) data.customer_name = fromWa;
        return render('DATE');
      }
      return reply('name', data, msgText(prefix + '¿A nombre de quién reservamos?'));
    }

    case 'DATE': {
      const r = byTool('get_available_dates');
      if (!r) return callTool('get_available_dates', slotArgs(data));
      const dates = (r.dates || []).filter(function (d) { return (Number(d.slots_available) || 0) > 0; });
      if (!dates.length) {
        data.handoff_reason = 'no hay turnos disponibles en los proximos 14 dias';
        return render('HANDOFF');
      }
      const rows = dates.slice(0, 9).map(function (d) {
        return { id: 'date:' + d.date, title: fmtDate(d.date), description: d.slots_available + ' horarios libres' };
      });
      rows.push({ id: 'nav:humano', title: 'Otra fecha', description: 'Coordinar con una persona' });
      return reply('date', data, msgList(prefix + 'Elegí el día 📅', 'Ver fechas', rows, 'Paso 4 de 7', 'Dias disponibles'));
    }

    case 'TIME': {
      const r = byTool('get_available_slots');
      if (!r) return callTool('get_available_slots', Object.assign({ date: data.scheduled_date }, slotArgs(data)));
      const slots = r.slots || [];
      if (!slots.length) { prefix = 'Ese día se quedó sin lugar 😕 Elegí otro:\n\n'; return render('DATE'); }
      const rows = slots.slice(0, 9).map(function (s) {
        return { id: 'time:' + s.start_time, title: fmtTime(s.start_time) + ' hs', description: 'termina ~' + fmtTime(s.end_time) + ' hs' };
      });
      rows.push({ id: 'time:back', title: 'Cambiar de día' });
      return reply('time', data, msgList(prefix + 'Turnos del ' + fmtDate(data.scheduled_date) + ' ⏰', 'Ver horarios', rows, 'Paso 5 de 7', 'Horarios'));
    }

    case 'PAY': {
      const q = byTool('calculate_booking_price');
      if (!q) return callTool('calculate_booking_price', {
        service_id: data.service_id,
        vehicle_type: data.vehicle_type || 'Auto',
        selected_extras: extrasList(data),
        vehicle_count: 1
      });
      if (!q.ok) return fail('No pude calcular el precio 😓');
      data.price = q.total_amount;
      const btns = [{ id: 'pay:mp', title: 'Mercado Pago' }, { id: 'pay:tr', title: 'Transferencia' }, { id: 'pay:later', title: 'Pagar después' }];
      const extraLine = extrasList(data).length ? '\nExtras: ' + extrasList(data).join(', ') : '';
      const body = prefix + 'Total: *' + money(q.total_amount) + '*\n(' + (data.service_name || 'servicio') + ' — ' + (data.vehicle_type || '') + extraLine + ')\n\n¿Cómo preferís pagar?';
      return reply('pay', data, msgButtons(body, btns, 'Paso 6 de 7'));
    }

    case 'CONFIRM': {
      if (data.price == null) {
        const q = byTool('calculate_booking_price');
        if (!q) return callTool('calculate_booking_price', {
          service_id: data.service_id,
          vehicle_type: data.vehicle_type || 'Auto',
          selected_extras: extrasList(data),
          vehicle_count: 1
        });
        data.price = q.total_amount;
      }
      const extraLine = extrasList(data).length ? '• Extras: ' + extrasList(data).join(', ') + '\n' : '';
      const body = prefix + 'Repasemos 📋\n\n' +
        '• Servicio: ' + (data.service_name || '-') + '\n' +
        '• Vehículo: ' + (data.vehicle_type || '-') + '\n' + extraLine +
        '• Cuándo: ' + fmtDate(data.scheduled_date) + ' a las ' + fmtTime(data.scheduled_time) + ' hs\n' +
        '• Dónde: ' + (data.formatted_address || data.address || '-') + '\n' +
        '• Pago: ' + (data.payment_method || '-') + '\n' +
        '• Total: ' + money(data.price) + '\n\n¿Confirmamos?';
      return reply('confirm', data, msgButtons(body, [{ id: 'cf:yes', title: 'Confirmar' }, { id: 'cf:no', title: 'Cancelar' }], 'Confirmación'));
    }

    case 'CREATE': {
      const cb = byTool('create_booking');
      if (!cb) return callTool('create_booking', {
        customer_name: data.customer_name || norm.name || '',
        address: data.address || data.formatted_address,
        neighborhood: data.neighborhood,
        address_type: data.address_type || 'street',
        private_neighborhood_id: data.private_neighborhood_id || '',
        private_lot: data.private_lot || '',
        service_id: data.service_id,
        vehicle_type: data.vehicle_type || 'Auto',
        selected_extras: extrasList(data),
        scheduled_date: data.scheduled_date,
        scheduled_time: data.scheduled_time,
        payment_method: data.payment_method,
        place_id: data.place_id || '',
        formatted_address: data.formatted_address || data.address,
        address_lat: data.address_lat,
        address_lng: data.address_lng,
        coverage_zone_id: data.coverage_zone_id || '',
        coverage_zone_name: data.coverage_zone_name || '',
        confirmation_message_id: norm.external_message_id || ''
      });
      if (!cb.ok) {
        if (cb.reason === 'slot_unavailable' || cb.reason === 'no_capacity') {
          prefix = 'Uy, justo se ocupó ese turno 😓 Elegí otro día:\n\n';
          return render('DATE');
        }
        if (cb.reason === 'outside_coverage' || cb.reason === 'not_in_coverage') {
          return render('OUTSIDE');
        }
        data.handoff_reason = 'create_booking fallo: ' + (cb.reason || cb.message || 'desconocido');
        return render('HANDOFF');
      }
      const bk = cb.booking || {};
      data.booking_id = bk.id;
      return renderPayment(bk, data.payment_method, null);
    }

    case 'WAITPAY':
      return reply('await_receipt', { misses: Number(data.misses) || 0, booking_id: data.booking_id, awaiting_receipt: true }, msgText(prefix + 'Cuando transferiste, mandame la foto o el PDF del comprobante por este chat.'));

    case 'RECEIPT_ACK':
    case 'RECEIPT': {
      const r = receipt || byTool('ingest_receipt');
      if (!r) return callTool('ingest_receipt', {
        media_id: mediaId,
        mime_type: norm.mime_type || '',
        file_name: norm.file_name || '',
        message_type: mtype === 'document' ? 'document' : 'image',
        external_message_id: norm.external_message_id || '',
        booking_id: data.booking_id || data0.booking_id || ''
      });
      const outcome = String(r.outcome || '');
      if (outcome === 'pending_review') {
        return reply('none', { misses: 0 }, msgText('Recibimos tu comprobante y lo vamos a revisar.\n\nEscribí *menu* para volver al inicio.'));
      }
      if (outcome === 'unresolved') {
        return reply('none', { misses: 0 }, msgText('Recibimos tu comprobante. Un humano lo revisa y lo asocia a la reserva.\n\nEscribí *menu* para volver al inicio.'));
      }
      if (outcome === 'duplicate') {
        return reply('none', { misses: 0 }, msgText('Ya teníamos ese comprobante. Lo seguimos revisando.\n\nEscribí *menu* para volver al inicio.'));
      }
      if (outcome === 'capture_error') {
        data.handoff_reason = 'no se pudo guardar el comprobante de transferencia';
        return render('HANDOFF');
      }
      prefix = 'No pude leer ese archivo 😕 Probá de nuevo con una foto nítida o un PDF.\n\n';
      return render('WAITPAY');
    }

    case 'MYBK': {
      const r = byTool('list_customer_bookings');
      if (!r) return callTool('list_customer_bookings', { limit: 20 });
      const all = (r.bookings || []).filter(function (b) {
        return b.booking_status !== 'cancelled' && b.booking_status !== 'completed';
      });
      if (!all.length) return fail('No encontré reservas activas a tu nombre 🔍');
      const rows = all.slice(0, 10).map(function (b) {
        return {
          id: 'bk:' + b.id,
          title: fmtDate(b.scheduled_date) + ' ' + fmtTime(b.scheduled_time),
          description: (b.service_name || '') + ' — ' + money(b.price)
        };
      });
      return reply('mybk', data, msgList(prefix + 'Tus reservas activas 📋\nElegí una para reprogramar o cancelar.\nSi querés cambiar dirección o servicio, cancelá y hacé una nueva.', 'Ver reservas', rows, 'Mis reservas', 'Reservas'));
    }

    case 'BKACT': {
      const r = byTool('get_booking');
      if (!r) return callTool('get_booking', { booking_id: data.sel_booking_id });
      const b = r.booking || {};
      if (!r.ok || !b.id) return fail('No pude encontrar esa reserva 😓');
      const body = prefix + 'Reserva del ' + fmtDate(b.scheduled_date) + ' a las ' + fmtTime(b.scheduled_time) + ' hs\n\n' +
        '• ' + (b.service_name || '-') + ' — ' + (b.vehicle_type || '') + '\n' +
        '• ' + (b.address || '') + '\n' +
        '• ' + money(b.price) + ' — ' + (b.payment_method || '') + '\n\n¿Qué querés hacer?';
      const btns = [{ id: 'act:resched', title: 'Reprogramar' }, { id: 'act:cancel', title: 'Cancelar' }, { id: 'act:back', title: 'Volver' }];
      return reply('bkact', data, msgButtons(body, btns, 'Tu reserva'));
    }

    case 'RDATE': {
      const g = byTool('get_booking');
      if (!g) return callTool('get_booking', { booking_id: data.sel_booking_id });
      const b = g.booking || {};
      const sd = byTool('get_service_details');
      if (!sd) return callTool('get_service_details', { service_name: b.service_name });
      if (!sd.ok || !sd.service) return fail('No pude reprogramar esa reserva 😓');
      data.r_service_id = sd.service.id;
      data.r_vehicle_type = b.vehicle_type || 'Auto';
      const av = byTool('get_available_dates');
      if (!av) return callTool('get_available_dates', { service_id: sd.service.id, vehicle_type: data.r_vehicle_type });
      const dates = (av.dates || []).filter(function (d) { return (Number(d.slots_available) || 0) > 0; });
      if (!dates.length) {
        data.handoff_reason = 'no hay fechas libres para reprogramar la reserva ' + data.sel_booking_id;
        return render('HANDOFF');
      }
      const rows = dates.slice(0, 9).map(function (d) { return { id: 'date:' + d.date, title: fmtDate(d.date), description: d.slots_available + ' horarios libres' }; });
      rows.push({ id: 'nav:humano', title: 'Otra fecha', description: 'Coordinar con una persona' });
      return reply('rdate', data, msgList(prefix + 'Elegí el nuevo día 📅', 'Ver fechas', rows, 'Reprogramar', 'Dias disponibles'));
    }

    case 'RTIME': {
      const av = byTool('get_available_slots');
      if (!av) return callTool('get_available_slots', { date: data.new_date, service_id: data.r_service_id, vehicle_type: data.r_vehicle_type || 'Auto' });
      const slots = av.slots || [];
      if (!slots.length) { prefix = 'Ese día se quedó sin lugar 😕 Elegí otro:\n\n'; return render('RDATE'); }
      const rows = slots.slice(0, 10).map(function (s) { return { id: 'time:' + s.start_time, title: fmtTime(s.start_time) + ' hs' }; });
      return reply('rtime', data, msgList(prefix + 'Turnos del ' + fmtDate(data.new_date) + ' ⏰', 'Ver horarios', rows, 'Reprogramar', 'Horarios'));
    }

    case 'RESCHED': {
      const r = byTool('reschedule_booking');
      if (!r) return callTool('reschedule_booking', { booking_id: data.sel_booking_id, new_date: data.new_date, new_time: data.new_time });
      if (!r.ok) {
        prefix = 'No pude mover la reserva a ese horario 😕 Probemos otro día:\n\n';
        return render('RDATE');
      }
      return reply('none', { misses: 0 }, msgText('Listo, tu reserva quedó para el ' + fmtDate(data.new_date) + ' a las ' + fmtTime(data.new_time) + ' hs ✅\n\nEscribí *menu* para volver al inicio.'));
    }

    case 'CXLCONF': {
      const btns = [{ id: 'cf:yes', title: 'Sí, cancelar' }, { id: 'cf:no', title: 'No, volver' }];
      return reply('cxlconf', data, msgButtons(prefix + '¿Seguro que querés cancelar esta reserva? No se puede deshacer.', btns, 'Cancelar reserva'));
    }

    case 'DOCANCEL': {
      const r = byTool('cancel_booking');
      if (!r) return callTool('cancel_booking', { booking_id: data.sel_booking_id });
      if (!r.ok) {
        data.handoff_reason = 'cancel_booking fallo para ' + data.sel_booking_id;
        return render('HANDOFF');
      }
      return reply('none', { misses: 0 }, msgText('Tu reserva quedó cancelada ✅\nSi querés cambiar dirección o servicio, hacé una reserva nueva con *menu*.'));
    }

    case 'HANDOFF': {
      const r = byTool('request_human_handoff');
      if (!r) return callTool('request_human_handoff', { reason: data.handoff_reason || 'derivacion desde el flujo de WhatsApp' });
      return reply('handoff', { misses: 0 }, msgText(T.handoff));
    }

    default:
      return reply('menu', { misses: 0 }, menuMsg(''));
  }
}

return render(step);
