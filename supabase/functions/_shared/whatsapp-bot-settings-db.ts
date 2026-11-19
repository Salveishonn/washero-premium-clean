// Reads the editable bot settings (public.whatsapp_bot_settings). Never throws: on any error
// the bot keeps its built-in defaults.
import { type BotSettings, resolveBotSettings } from "./whatsapp-bot-settings.ts";

// deno-lint-ignore no-explicit-any
export async function loadBotSettings(admin: any): Promise<BotSettings> {
  try {
    const { data, error } = await admin
      .from("whatsapp_bot_settings")
      .select("settings")
      .eq("id", true)
      .maybeSingle();
    if (error) return resolveBotSettings({});
    return resolveBotSettings(data?.settings ?? {});
  } catch {
    return resolveBotSettings({});
  }
}
