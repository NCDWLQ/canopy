import { SlidersHorizontal } from "lucide-react"

import { CUSTOM_PRESET_ID, type ProviderPresetSelection } from "../presets"
import { PROVIDER_PRESET_ICON_PATHS } from "./provider-preset-icon-paths"

export type ProviderPresetIconProps = {
  presetId: ProviderPresetSelection
}

function BrandIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d={path} />
    </svg>
  )
}

export function ProviderPresetIcon({ presetId }: ProviderPresetIconProps) {
  if (presetId === CUSTOM_PRESET_ID) {
    return <SlidersHorizontal aria-hidden />
  }

  return <BrandIcon path={PROVIDER_PRESET_ICON_PATHS[presetId]} />
}
