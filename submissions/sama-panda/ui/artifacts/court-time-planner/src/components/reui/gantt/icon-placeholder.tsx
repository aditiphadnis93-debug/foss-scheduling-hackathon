import * as Icons from "lucide-react"
import type { LucideProps } from "lucide-react"

type IconPlaceholderProps = LucideProps & {
  lucide?: keyof typeof Icons
  tabler?: string
  hugeicons?: string
  phosphor?: string
  remixicon?: string
}

/** Generated ReUI icon adapter, using the app's installed Lucide set. */
export function IconPlaceholder({
  lucide = "Circle",
  tabler: _tabler,
  hugeicons: _hugeicons,
  phosphor: _phosphor,
  remixicon: _remixicon,
  ...props
}: IconPlaceholderProps) {
  const name = lucide.endsWith("Icon") ? lucide.slice(0, -4) : lucide
  const Icon = Icons[name as keyof typeof Icons] as
    | React.ComponentType<LucideProps>
    | undefined
  if (!Icon) return null
  return <Icon {...props} />
}