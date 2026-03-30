import type { ChatMessage, ChatMode } from "@/lib/types";

const MODE_LABEL: Record<ChatMode, string> = {
  recommendation: "\u667a\u80fd\u63a8\u8350",
  comparison: "\u8f66\u578b\u5bf9\u6bd4",
  service: "\u7528\u8f66\u987e\u95ee",
  configurator: "\u914d\u7f6e\u65b9\u6848",
};

function modeLine(mode?: ChatMode): string {
  if (!mode) return "";
  return `\uff08${MODE_LABEL[mode]}\uff09`;
}

export function messagesToMarkdown(messages: ChatMessage[]): string {
  const lines = [
    "# \u667a\u9009\u8f66 Agent \u5bf9\u8bdd\u5bfc\u51fa",
    "",
    `\u5bfc\u51fa\u65f6\u95f4\uff1a${new Date().toLocaleString("zh-CN")}`,
    "",
    "---",
    "",
  ];

  for (const message of messages) {
    if (message.role === "user") {
      lines.push("## \u7528\u6237", "", message.content, "", "");
      continue;
    }

    lines.push(`## \u52a9\u624b${modeLine(message.mode)}`, "", message.content, "", "");
  }

  return lines.join("\n");
}

export function messagesToJson(messages: ChatMessage[]): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "xpeng-car-ai",
    messages: messages.map(({ id, role, content, mode }) => ({
      id,
      role,
      content,
      mode: mode ?? null,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}
