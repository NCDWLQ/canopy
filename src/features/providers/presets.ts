import type { StaticMessageKey } from "@/lib/i18n"
import type { ProviderProtocol } from "./types"

export const CUSTOM_PRESET_ID = "custom" as const

export type ProviderPresetId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "kimi"
  | "glm-bigmodel"
  | "glm-zai"
  | "openrouter"
  | "gemini"
  | "opencode-go"

export type ProviderPresetSelection = typeof CUSTOM_PRESET_ID | ProviderPresetId

export type ProviderPreset = {
  id: ProviderPresetId
  nameKey: StaticMessageKey
  protocol: ProviderProtocol
  baseEndpoint: string
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openai",
    nameKey: "settings.providers.preset.openai",
    protocol: "openai_compatible",
    baseEndpoint: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    nameKey: "settings.providers.preset.anthropic",
    protocol: "anthropic",
    baseEndpoint: "https://api.anthropic.com",
  },
  {
    id: "deepseek",
    nameKey: "settings.providers.preset.deepseek",
    protocol: "openai_compatible",
    baseEndpoint: "https://api.deepseek.com/v1",
  },
  {
    id: "kimi",
    nameKey: "settings.providers.preset.kimi",
    protocol: "openai_compatible",
    baseEndpoint: "https://api.moonshot.cn/v1",
  },
  {
    id: "glm-bigmodel",
    nameKey: "settings.providers.preset.glmBigmodel",
    protocol: "openai_compatible",
    baseEndpoint: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "glm-zai",
    nameKey: "settings.providers.preset.glmZai",
    protocol: "openai_compatible",
    baseEndpoint: "https://api.z.ai/api/paas/v4",
  },
  {
    id: "openrouter",
    nameKey: "settings.providers.preset.openrouter",
    protocol: "openai_compatible",
    baseEndpoint: "https://openrouter.ai/api/v1",
  },
  {
    id: "gemini",
    nameKey: "settings.providers.preset.gemini",
    protocol: "openai_compatible",
    baseEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "opencode-go",
    nameKey: "settings.providers.preset.opencodeGo",
    protocol: "openai_compatible",
    baseEndpoint: "https://opencode.ai/zen/go/v1",
  },
]

export function findProviderPreset(
  id: ProviderPresetId,
): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

export function isProviderPresetId(value: string): value is ProviderPresetId {
  return PROVIDER_PRESETS.some((preset) => preset.id === value)
}
