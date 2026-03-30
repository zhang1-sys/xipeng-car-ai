"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AssistantBubble } from "@/components/AssistantBubble";
import { ChatHeader } from "@/components/ChatHeader";
import { ConfiguratorWizard } from "@/components/ConfiguratorWizard";
import { OfferModal, StoreModal, TestDriveModal } from "@/components/Modals";
import { ModeChip } from "@/components/ModeChip";
import { fetchBusinessDataStatus, postChat, postConfigurator } from "@/lib/api";
import type { ChatMode } from "@/lib/types";
import type {
  AgentPayload,
  BusinessDataItemStatus,
  ChatMessage,
  ConfiguratorChoicesPayload,
  ConfiguratorStructured,
} from "@/lib/types";

const CHAT_SESSION_STORAGE_KEY = "xpeng_car_ai_chat_session_id";
const CONFIGURATOR_SESSION_STORAGE_KEY = "xpeng_car_ai_configurator_session_id";
const MODE_OPTIONS: Array<{ mode: Exclude<ChatMode, "configurator">; label: string }> = [
  { mode: "recommendation", label: "车型推荐" },
  { mode: "comparison", label: "车型对比" },
  { mode: "service", label: "用车服务" },
];

const QUICK_PROMPTS: Array<{ label: string; text: string; mode: Exclude<ChatMode, "configurator"> }> = [
  {
    label: "开始推荐",
    text: "预算 18 到 22 万，工作日城市通勤，周末带家人短途出行，推荐两款适合重点试驾的小鹏车型。",
    mode: "recommendation",
  },
  {
    label: "做车型对比",
    text: "我更在意辅助驾驶、空间和乘坐舒适性，帮我对比小鹏 G6 和小鹏 G9。",
    mode: "comparison",
  },
  {
    label: "问用车服务",
    text: "第一次买纯电车，家里能装充电桩，想知道真实使用体验和注意事项。",
    mode: "service",
  },
];

function createMessage(
  role: ChatMessage["role"],
  content: string,
  extra?: Partial<ChatMessage>
): ChatMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    role,
    content,
    ...extra,
  };
}

function ConfiguratorHero({
  state,
  agent,
  choices,
  busy,
  snapshotInfo,
  onAction,
  onReset,
}: {
  state: ConfiguratorStructured | null;
  agent: AgentPayload | null;
  choices: ConfiguratorChoicesPayload | null;
  busy: boolean;
  snapshotInfo: BusinessDataItemStatus | null;
  onAction: (text: string) => void;
  onReset: () => void;
}) {
  return (
    <section className="space-y-5">
      {/* ── Immersive Dark Configurator ─────────────────────── */}
      <ConfiguratorWizard
        state={state}
        agent={agent}
        choices={choices}
        busy={busy}
        onAction={onAction}
        onReset={onReset}
      />

      {/* ── Quick entry buttons (light theme, sits below configurator) */}
      {!state ? (
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-[#ede1d5] bg-white/90 px-5 py-4 shadow-sm">
          <p className="mr-2 text-xs font-medium text-ink-500">快速开始：</p>
          {[
            { label: "配置 G6", action: "我想配置 小鹏 G6" },
            { label: "配置 G9", action: "我想配置 小鹏 G9" },
            { label: "配置 P7i", action: "我想配置 小鹏 P7i" },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={busy}
              onClick={() => onAction(item.action)}
              className="rounded-full bg-gradient-to-r from-[#eb5b2a] to-[#ff7b36] px-4 py-2 text-xs font-semibold text-white transition hover:from-[#d84e1f] hover:to-[#f16a26] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [configuratorSessionId, setConfiguratorSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testDriveOpen, setTestDriveOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [testDriveCar, setTestDriveCar] = useState<string | undefined>(undefined);
  const [businessData, setBusinessData] = useState<Record<string, BusinessDataItemStatus> | null>(null);
  const [activeChatMode, setActiveChatMode] = useState<Exclude<ChatMode, "configurator">>("recommendation");
  const [configuratorState, setConfiguratorState] = useState<ConfiguratorStructured | null>(null);
  const [configuratorAgent, setConfiguratorAgent] = useState<AgentPayload | null>(null);
  const [configuratorChoices, setConfiguratorChoices] = useState<ConfiguratorChoicesPayload | null>(null);

  useEffect(() => {
    try {
      const savedChatSession = localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
      const savedConfiguratorSession = localStorage.getItem(CONFIGURATOR_SESSION_STORAGE_KEY);
      if (savedChatSession) setChatSessionId(savedChatSession);
      if (savedConfiguratorSession) setConfiguratorSessionId(savedConfiguratorSession);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchBusinessDataStatus();
        if (!cancelled) setBusinessData(status.sources || null);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function syncConfiguratorState(response: {
    structured?: ConfiguratorStructured | null;
    configState?: ConfiguratorStructured | null;
    agent?: AgentPayload | null;
    choices?: ConfiguratorChoicesPayload | null;
  }) {
    setConfiguratorState((response.structured as ConfiguratorStructured | null) || response.configState || null);
    setConfiguratorAgent(response.agent || null);
    setConfiguratorChoices(response.choices || null);
  }

  async function submitMessage(
    message: string,
    channel: "chat" | "configurator" = "chat",
    mode?: Exclude<ChatMode, "configurator">
  ) {
    const text = message.trim();
    if (!text || busy) return;

    if (channel === "chat") {
      const userMessage = createMessage("user", text, {
        mode,
      });
      setMessages((current) => [...current, userMessage]);
    }
    setInput("");
    setError(null);
    setBusy(true);

    try {
      if (channel === "configurator") {
        const response = await postConfigurator(text, configuratorSessionId);
        if (response.sessionId) {
          try {
            setConfiguratorSessionId(response.sessionId);
            localStorage.setItem(CONFIGURATOR_SESSION_STORAGE_KEY, response.sessionId);
          } catch {}
        }
        syncConfiguratorState(response);
      } else {
        const response = await postChat(text, chatSessionId, mode);
        if (response.sessionId) {
          try {
            setChatSessionId(response.sessionId);
            localStorage.setItem(CHAT_SESSION_STORAGE_KEY, response.sessionId);
          } catch {}
        }
        setMessages((current) => [
          ...current,
          createMessage("assistant", response.reply, {
            mode: response.mode,
            structured: response.structured ?? undefined,
            requestId: response.requestId,
            agent: response.agent ?? undefined,
          }),
        ]);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "请求失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(input, "chat", activeChatMode);
  }

  function handleNewChat() {
    setMessages([]);
    setInput("");
    setError(null);
    setChatSessionId(null);
    setConfiguratorSessionId(null);
    setConfiguratorState(null);
    setConfiguratorAgent(null);
    setConfiguratorChoices(null);
    try {
      localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
      localStorage.removeItem(CONFIGURATOR_SESSION_STORAGE_KEY);
    } catch {}
  }

  function handleResetConfigurator() {
    setError(null);
    setConfiguratorState(null);
    setConfiguratorAgent(null);
    setConfiguratorChoices(null);
    setConfiguratorSessionId(null);
    try {
      localStorage.removeItem(CONFIGURATOR_SESSION_STORAGE_KEY);
    } catch {}
  }

  const configuratorSnapshot = businessData?.configurator || null;
  const catalogSnapshot = businessData?.catalog || null;

  const heroSnapshotMeta = useMemo(() => {
    const pieces = [
      catalogSnapshot?.version ? `目录版本 ${catalogSnapshot.version}` : null,
      configuratorSnapshot?.version ? `配置器版本 ${configuratorSnapshot.version}` : null,
      configuratorSnapshot?.fetchedAt ? `快照时间 ${configuratorSnapshot.fetchedAt.slice(0, 10)}` : null,
    ].filter(Boolean);
    return pieces.join(" · ");
  }, [catalogSnapshot, configuratorSnapshot]);

  return (
    <main className="app-mesh-bg min-h-screen">
      <ChatHeader
        hasMessages={messages.length > 0}
        busy={busy}
        onNewChat={handleNewChat}
        onConfigurator={() => void submitMessage("我想开始配置一台更适合我的小鹏汽车。", "configurator")}
        onQuickAsk={(text, mode) => {
          setActiveChatMode(mode);
          void submitMessage(text, "chat", mode);
        }}
      />

      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <ConfiguratorHero
          state={configuratorState}
          agent={configuratorAgent}
          choices={configuratorChoices}
          busy={busy}
          snapshotInfo={configuratorSnapshot}
          onAction={(text) => void submitMessage(text, "configurator")}
          onReset={handleResetConfigurator}
        />

        <section className="grid gap-6">
          <div className="flex min-h-[72vh] flex-col overflow-hidden rounded-[32px] border border-white/80 bg-white/92 shadow-card">
            <div className="border-b border-ink-100/80 px-5 py-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#b76438]">推荐 / 对比 / 服务咨询</p>
              <p className="mt-2 text-sm leading-7 text-ink-600">
                配置器已经独立在上方。这里保留推荐、对比和服务答疑，帮助你解释为什么选这台车、怎么比较、后续怎么用。
              </p>
              {heroSnapshotMeta ? <p className="mt-2 text-xs text-ink-500">{heroSnapshotMeta}</p> : null}
            </div>

            <div className="chat-scroll flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-dashed border-[#f0c6a8] bg-[#fff8f2] p-6">
                    <p className="text-lg font-semibold text-ink-900">配置器在上方；下面选一个咨询模式继续。</p>
                    <div className="mt-4 grid gap-3">
                      {QUICK_PROMPTS.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setActiveChatMode(item.mode);
                            void submitMessage(item.text, "chat", item.mode);
                          }}
                          className="rounded-2xl border border-[#eadfd4] bg-white px-4 py-3 text-left text-sm leading-6 text-ink-700 transition hover:border-[#eb5b2a] hover:bg-[#fff7f1]"
                        >
                          <span className="font-semibold text-ink-900">{item.label}</span>
                          <span className="mt-1 block text-xs text-ink-500">{item.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  {message.role === "user" ? (
                    <div className="max-w-3xl rounded-[26px] bg-[#1f2937] px-4 py-3 text-sm leading-7 text-white shadow-sm">
                      {message.content}
                    </div>
                  ) : (
                    <div className="max-w-4xl space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-[#fff3e8] px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-[#b84d24]">
                          顾问回复
                        </span>
                        {message.mode ? <ModeChip mode={message.mode} /> : null}
                      </div>
                      <div className="rounded-[26px] border border-white/90 bg-white/98 px-4 py-4 shadow-sm">
                        <AssistantBubble
                          msg={message}
                          onTestDrive={(carName) => {
                            setTestDriveCar(carName);
                            setTestDriveOpen(true);
                          }}
                          onStores={() => setStoreOpen(true)}
                          onOffer={() => setOfferOpen(true)}
                          onFollowup={(text) =>
                            void submitMessage(
                              text,
                              message.mode === "configurator" ? "configurator" : "chat",
                              message.mode && message.mode !== "configurator" ? message.mode : activeChatMode
                            )
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {busy ? (
                <div className="max-w-4xl rounded-[26px] border border-[#f1d9c8] bg-white/95 px-4 py-4">
                  <div className="ai-shimmer h-4 w-40 rounded-full" />
                  <div className="ai-shimmer mt-3 h-4 w-full rounded-full" />
                  <div className="ai-shimmer mt-2 h-4 w-4/5 rounded-full" />
                </div>
              ) : null}
            </div>

            <div className="border-t border-ink-100/80 p-4">
              <form className="space-y-3" onSubmit={handleSubmit}>
                <div className="flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((item) => {
                    const active = activeChatMode === item.mode;
                    return (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => setActiveChatMode(item.mode)}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                          active
                            ? "border-[#eb5b2a] bg-[#fff3e8] text-[#8f421d]"
                            : "border-ink-200 bg-white text-ink-600 hover:border-[#eb5b2a] hover:text-[#8f421d]"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitMessage("我想开始配置一台更适合我的小鹏汽车。", "configurator")}
                    className="rounded-full border border-[#f3c9a8] bg-[#fff3e8] px-4 py-2 text-sm font-semibold text-[#8f431f] transition hover:bg-[#ffe6d1] disabled:opacity-50"
                  >
                    去做选配
                  </button>
                </div>

                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={
                    activeChatMode === "recommendation"
                      ? "例如：预算 18 到 22 万，工作日城市通勤，家里有老人和孩子，推荐两款重点试驾车型。"
                      : activeChatMode === "comparison"
                        ? "例如：帮我从空间、智驾、乘坐舒适性和价格，对比 G6 和 G9。"
                        : "例如：第一次买纯电车，家里能装充电桩，冬天续航和补能要注意什么？"
                  }
                  rows={4}
                  className="w-full resize-none rounded-3xl border border-ink-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#eb5b2a] focus:ring-4 focus:ring-[#fff1e6]"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-ink-500">
                    当前发送模式：
                    {activeChatMode === "recommendation"
                      ? "车型推荐"
                      : activeChatMode === "comparison"
                        ? "车型对比"
                        : "用车服务"}
                  </p>
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="rounded-full bg-gradient-to-r from-[#eb5b2a] to-[#ff7a32] px-5 py-2 text-sm font-semibold text-white transition hover:from-[#da4f20] hover:to-[#f56d27] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "正在整理建议..." : "发送咨询"}
                  </button>
                </div>
              </form>
              {error ? (
                <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <TestDriveModal
        open={testDriveOpen}
        onClose={() => setTestDriveOpen(false)}
        carName={testDriveCar}
      />
      <StoreModal open={storeOpen} onClose={() => setStoreOpen(false)} />
      <OfferModal open={offerOpen} onClose={() => setOfferOpen(false)} />
    </main>
  );
}
