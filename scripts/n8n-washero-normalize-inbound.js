const out = [];
for (const item of $input.all()) {
  const j = item.json || {};
  const m = (j.messages && j.messages[0]) || {};
  const c = (j.contacts && j.contacts[0]) || {};
  const inter = m.interactive || {};
  const br = inter.button_reply || {};
  const lr = inter.list_reply || {};
  const loc = m.location || {};
  const img = m.image || {};
  const doc = m.document || {};
  const body =
    (m.text && m.text.body) ||
    img.caption ||
    doc.caption ||
    lr.title ||
    br.title ||
    "";
  out.push({
    json: {
      phone: String(m.from || ""),
      name: String((c.profile && c.profile.name) || ""),
      conversation_id: String(m.from || ""),
      message_type: String(m.type || "unknown"),
      message_text: String(body),
      reply_id: String(lr.id || br.id || ""),
      reply_title: String(lr.title || br.title || ""),
      external_message_id: String(m.id || ""),
      media_id: String(img.id || doc.id || (m.audio && m.audio.id) || (m.sticker && m.sticker.id) || ""),
      mime_type: String(img.mime_type || doc.mime_type || ""),
      file_name: String(doc.filename || ""),
      lat: loc.latitude != null ? Number(loc.latitude) : null,
      lng: loc.longitude != null ? Number(loc.longitude) : null,
    },
  });
}
return out;
