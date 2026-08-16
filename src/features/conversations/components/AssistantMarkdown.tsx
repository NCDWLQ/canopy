import type { ComponentProps, ReactNode } from "react"
import { code } from "@streamdown/code"
import {
  Streamdown,
  defaultRehypePlugins,
  type Components,
  type ControlsConfig,
  type StreamdownProps,
  type StreamdownTranslations,
  type UrlTransform,
} from "streamdown"

export type AssistantMarkdownProps = {
  content: string
  isStreaming?: boolean
}

const SANITIZE_PLUGIN = defaultRehypePlugins.sanitize
const HARDEN_CONFIG = defaultRehypePlugins.harden

if (SANITIZE_PLUGIN === undefined || HARDEN_CONFIG === undefined) {
  throw new Error("Streamdown 安全插件不可用。")
}

const HARDEN_PLUGIN = Array.isArray(HARDEN_CONFIG)
  ? HARDEN_CONFIG[0]
  : HARDEN_CONFIG

if (HARDEN_PLUGIN === undefined || typeof HARDEN_PLUGIN !== "function") {
  throw new Error("Streamdown URL 加固插件不可用。")
}

const SAFE_REHYPE_PLUGINS = [
  SANITIZE_PLUGIN,
  [
    HARDEN_PLUGIN,
    {
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: [],
      allowedProtocols: ["http:", "https:", "mailto:"],
      linkBlockPolicy: "text-only",
      imageBlockPolicy: "text-only",
    },
  ],
] satisfies NonNullable<StreamdownProps["rehypePlugins"]>

const MARKDOWN_PLUGINS = { code }

const MARKDOWN_CONTROLS = {
  table: false,
  code: { copy: true, download: false },
  mermaid: false,
} satisfies ControlsConfig

const MARKDOWN_TRANSLATIONS = {
  copyCode: "复制代码",
  copied: "已复制",
} satisfies Partial<StreamdownTranslations>

const safeUrlTransform: UrlTransform = (url) => {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === "http:" ||
      parsedUrl.protocol === "https:" ||
      parsedUrl.protocol === "mailto:"
      ? parsedUrl.href
      : undefined
  } catch {
    return undefined
  }
}

type MarkdownAnchorProps =
  | ComponentProps<"a">
  | (Record<string, unknown> & { children?: ReactNode; href?: unknown })
type MarkdownImageProps =
  ComponentProps<"img"> | (Record<string, unknown> & { alt?: unknown })

function SafeLink(props: MarkdownAnchorProps) {
  const children = props.children
  const href = typeof props.href === "string" ? props.href : undefined

  if (href === undefined) {
    return <span>{children}</span>
  }

  return (
    <a
      className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  )
}

function ImageAltText(props: MarkdownImageProps) {
  const alt = typeof props.alt === "string" ? props.alt : undefined
  return alt ? <span>{alt}</span> : null
}

type MarkdownTableProps =
  ComponentProps<"table"> | (Record<string, unknown> & { children?: ReactNode })

// streamdown 默认给表格套双层卡片(wrapper 卡片 + 内层滚动盒,双层边框/背景/内边距)。
// controls.table 已关闭,外层卡片无功能,这里收敛为单层滚动容器。
function LeanTable(props: MarkdownTableProps) {
  return (
    <div className="my-4 overflow-x-auto rounded-md border border-border">
      <table className="w-full divide-y divide-border" data-streamdown="table">
        {props.children}
      </table>
    </div>
  )
}

const MARKDOWN_COMPONENTS = {
  a: SafeLink,
  img: ImageAltText,
  table: LeanTable,
} satisfies Components

export function AssistantMarkdown({
  content,
  isStreaming = false,
}: AssistantMarkdownProps) {
  return (
    <Streamdown
      className="assistant-markdown min-w-0 break-words text-sm text-foreground [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-ring"
      components={MARKDOWN_COMPONENTS}
      controls={MARKDOWN_CONTROLS}
      isAnimating={isStreaming}
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown
      plugins={MARKDOWN_PLUGINS}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
      skipHtml
      translations={MARKDOWN_TRANSLATIONS}
      urlTransform={safeUrlTransform}
    >
      {content}
    </Streamdown>
  )
}
