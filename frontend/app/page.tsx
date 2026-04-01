"use client";

import dynamic from "next/dynamic";
import { FormEvent, memo, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { AssistantBubble } from "@/components/AssistantBubble";
import { ChatHeader } from "@/components/ChatHeader";
import { ModeChip } from "@/components/ModeChip";
import { postConfigurator, streamChat } from "@/lib/api";
import type { ChatMode } from "@/lib/types";
import type {
  ChatMessage,
  ConfiguratorChoicesPayload,
  ConfiguratorStructured,
} from "@/lib/types";

const CHAT_SESSION_STORAGE_KEY = "xpeng_car_ai_chat_session_id";
const CONFIGURATOR_SESSION_STORAGE_KEY = "xpeng_car_ai_configurator_session_id";
const CLIENT_PROFILE_STORAGE_KEY = "xpeng_car_ai_client_profile_id";
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

function ConfiguratorLoadingState() {
  return (
    <div className="cfg-glass rounded-[28px] px-5 py-6">
      <div className="ai-shimmer h-4 w-40 rounded-full" />
      <div className="ai-shimmer mt-4 h-6 w-64 rounded-full" />
      <div className="ai-shimmer mt-5 h-40 w-full rounded-[28px]" />
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="ai-shimmer h-24 rounded-[22px]" />
        <div className="ai-shimmer h-24 rounded-[22px]" />
        <div className="ai-shimmer h-24 rounded-[22px]" />
      </div>
    </div>
  );
}

const LazyConfiguratorWizard = dynamic(
  () =>
    import("@/components/ConfiguratorWizard").then((module) => module.ConfiguratorWizard),
  {
    ssr: false,
    loading: () => <ConfiguratorLoadingState />,
  }
);

const LazyTestDriveModal = dynamic(
  () => import("@/components/Modals").then((module) => module.TestDriveModal),
  { ssr: false }
);

const LazyStoreModal = dynamic(
  () => import("@/components/Modals").then((module) => module.StoreModal),
  { ssr: false }
);

const LazyOfferModal = dynamic(
  () => import("@/components/Modals").then((module) => module.OfferModal),
  { ssr: false }
);

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

function inferChatMode(
  text: string
): Exclude<ChatMode, "configurator"> | undefined {
  const raw = text.trim();
  if (!raw) return undefined;

  if (
    /\bvs\b|对比|比较|哪个好|怎么选|区别|差别|PK|和.*(比|对比|比较)|跟.*(比|对比|比较)/i.test(raw)
  ) {
    return "comparison";
  }

  if (
    /推荐|买车|选车|购车|预算|适合我|帮我选|车型|通勤|家用|SUV|轿车|MPV/i.test(raw)
  ) {
    return "recommendation";
  }

  if (
    /保养|充电|保险|事故|OTA|车机|提车|交付|售后|家充|续航|故障|异响|救援/i.test(raw)
  ) {
    return "service";
  }

  return undefined;
}

function describeStreamStep(step: {
  type: string;
  thought?: string;
  action?: string;
  observation?: string;
}) {
  const actionLabelMap: Record<string, string> = {
    recall_memory: "正在检查当前会话里是否已有可复用线索",
    search_catalog: "正在筛选符合条件的车型资料",
    compare_catalog: "正在整理车型对比信息",
    find_stores: "正在匹配离你更近的门店",
    search_service_knowledge: "正在检索相关服务知识和处理方案",
  };
  const normalizedAction = String(step.action || "").trim();
  const normalizedObservation = String(step.observation || "").trim();
  const detail = [step.thought, step.action, step.observation]
    .map((item) => String(item || "").trim())
    .find(Boolean);

  if (normalizedAction && actionLabelMap[normalizedAction]) return actionLabelMap[normalizedAction];
  if (normalizedObservation && actionLabelMap[normalizedObservation]) return actionLabelMap[normalizedObservation];
  if (detail) return detail;
  if (step.type === "reset") return "已切换更快模型，继续处理当前问题";
  if (step.type === "think") return "正在理解你的需求";
  if (step.type === "thought") return "正在理解你的需求";
  if (step.type === "act") return "正在检索车型和规则";
  if (step.type === "action") return "正在检索相关信息";
  if (step.type === "observe") return "正在整理结论";
  if (step.type === "error") return "当前步骤已切换到兜底处理";
  return "正在生成回复";
}

function describeStreamingLabel(type: string | undefined) {
  if (type === "reset") return "正在切换更快模型";
  if (type === "think") return "正在理解你的问题";
  if (type === "thought") return "正在理解你的问题";
  if (type === "act") return "正在检索车型与规则";
  if (type === "action") return "正在检索相关信息";
  if (type === "observe") return "正在整理结论";
  if (type === "error") return "正在切换兜底处理";
  return "正在生成回答";
}

const ConfiguratorHero = memo(function ConfiguratorHero({
  ready,
  state,
  choices,
  busy,
  onAction,
  onReset,
  onBookTestDrive,
  onAdvisorFollowup,
}: {
  ready: boolean;
  state: ConfiguratorStructured | null;
  choices: ConfiguratorChoicesPayload | null;
  busy: boolean;
  onAction: (text: string) => void;
  onReset: () => void;
  onBookTestDrive: (carName?: string) => void;
  onAdvisorFollowup: (carName?: string) => void;
}) {
  return (
    <section className="space-y-5">
      {ready ? (
        <LazyConfiguratorWizard
          state={state}
          choices={choices}
          busy={busy}
          onAction={onAction}
          onReset={onReset}
          onBookTestDrive={onBookTestDrive}
          onAdvisorFollowup={onAdvisorFollowup}
        />
      ) : (
        <ConfiguratorLoadingState />
      )}
    </section>
  );
});

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [configuratorSessionId, setConfiguratorSessionId] = useState<string | null>(null);
  const [clientProfileId, setClientProfileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyChannel, setBusyChannel] = useState<"chat" | "configurator" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testDriveOpen, setTestDriveOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [testDriveCar, setTestDriveCar] = useState<string | undefined>(undefined);
  const [leadIntent, setLeadIntent] = useState<"test_drive" | "advisor_followup">("test_drive");
  const [activeChatMode, setActiveChatMode] = useState<Exclude<ChatMode, "configurator">>("recommendation");
  const [configuratorState, setConfiguratorState] = useState<ConfiguratorStructured | null>(null);
  const [configuratorChoices, setConfiguratorChoices] = useState<ConfiguratorChoicesPayload | null>(null);
  const [shouldMountConfigurator, setShouldMountConfigurator] = useState(false);
  const configuratorBusy = busy && busyChannel === "configurator";

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const configuratorSectionRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  useEffect(() => {
    try {
      const savedChatSession = localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
      const savedConfiguratorSession = localStorage.getItem(CONFIGURATOR_SESSION_STORAGE_KEY);
      const savedClientProfileId = localStorage.getItem(CLIENT_PROFILE_STORAGE_KEY);
      if (savedChatSession) setChatSessionId(savedChatSession);
      if (savedConfiguratorSession) setConfiguratorSessionId(savedConfiguratorSession);
      if (savedClientProfileId) {
        setClientProfileId(savedClientProfileId);
      } else {
        const generated = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        localStorage.setItem(CLIENT_PROFILE_STORAGE_KEY, generated);
        setClientProfileId(generated);
      }
    } catch {}
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (shouldMountConfigurator || configuratorState || configuratorChoices) {
      setShouldMountConfigurator(true);
    }
  }, [shouldMountConfigurator, configuratorChoices, configuratorState]);

  useEffect(() => {
    if (shouldMountConfigurator) return;
    const node = configuratorSectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldMountConfigurator(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "720px 0px",
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldMountConfigurator]);

  function updateAssistantMessage(
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage
  ) {
    startTransition(() => {
      setMessages((current) =>
        current.map((item) => (item.id === messageId ? updater(item) : item))
      );
    });
  }

  function removeMessage(messageId: string) {
    setMessages((current) => current.filter((item) => item.id !== messageId));
  }

  function ensureClientProfile(): string | null {
    if (clientProfileId) return clientProfileId;
    try {
      const saved = localStorage.getItem(CLIENT_PROFILE_STORAGE_KEY);
      if (saved) {
        setClientProfileId(saved);
        return saved;
      }
      const generated = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      localStorage.setItem(CLIENT_PROFILE_STORAGE_KEY, generated);
      setClientProfileId(generated);
      return generated;
    } catch {
      return clientProfileId;
    }
  }

  async function animateAssistantReply(
    messageId: string,
    result: {
      reply: string;
      mode?: ChatMode;
      structured?: ChatMessage["structured"];
      requestId?: string;
      agent?: ChatMessage["agent"];
      uiHints?: ChatMessage["uiHints"];
    }
  ) {
    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    const fullReply = String(result.reply || "");
    if (!fullReply) {
      updateAssistantMessage(messageId, (message) => ({
        ...message,
        content: "",
        mode: result.mode,
        structured: result.structured,
        requestId: result.requestId,
        agent: result.agent,
        uiHints: result.uiHints,
        isStreaming: false,
        streamingLabel: undefined,
        streamingSteps: undefined,
        traceSteps: message.traceSteps || message.streamingSteps || [],
      }));
      return;
    }

    await new Promise<void>((resolve) => {
      let visibleLength = 0;
      const chunkSize = Math.max(4, Math.ceil(fullReply.length / 40));

      const flush = () => {
        visibleLength = Math.min(fullReply.length, visibleLength + chunkSize);
        const done = visibleLength >= fullReply.length;

        updateAssistantMessage(messageId, (message) => ({
          ...message,
          content: fullReply.slice(0, visibleLength),
          mode: result.mode,
          structured: done ? result.structured : undefined,
          requestId: result.requestId,
          agent: done ? result.agent : undefined,
          uiHints: done ? result.uiHints : undefined,
          isStreaming: done ? false : message.isStreaming,
          streamingLabel: done ? undefined : message.streamingLabel,
          streamingSteps: done ? undefined : message.streamingSteps,
          traceSteps: message.traceSteps || message.streamingSteps || [],
        }));

        if (done) {
          if (typingTimerRef.current) {
            window.clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }
          resolve();
        }
      };

      flush();
      if (visibleLength >= fullReply.length) return;
      typingTimerRef.current = window.setInterval(flush, 18);
    });
  }

  function syncConfiguratorState(response: {
    structured?: ConfiguratorStructured | null;
    configState?: ConfiguratorStructured | null;
    choices?: ConfiguratorChoicesPayload | null;
  }) {
    const nextState =
      (response.configState as ConfiguratorStructured | null) ||
      (response.structured as ConfiguratorStructured | null) ||
      null;
    setConfiguratorState(nextState);
    setConfiguratorChoices(response.choices || null);
  }

  const submitMessage = useCallback(async (
    message: string,
    channel: "chat" | "configurator" = "chat",
    mode?: Exclude<ChatMode, "configurator">
  ) => {
    const text = message.trim();
    if (!text || busy) return;
    const resolvedMode =
      channel === "chat" ? inferChatMode(text) || mode : undefined;
    const effectiveClientProfileId = channel === "chat" ? ensureClientProfile() : null;
    let assistantMessageId: string | null = null;

    if (channel === "chat") {
      const chatMode = resolvedMode || activeChatMode;
      const userMessage = createMessage("user", text, {
        mode: chatMode,
      });
      const assistantMessage = createMessage("assistant", "", {
        mode: chatMode,
        isStreaming: true,
        streamingLabel: "正在理解你的问题",
        streamingSteps: ["已收到你的问题，正在开始分析"],
        traceSteps: ["已收到你的问题，正在开始分析。"],
      });
      assistantMessageId = assistantMessage.id;
      if (resolvedMode) {
        setActiveChatMode(resolvedMode);
      }
      setMessages((current) => [...current, userMessage, assistantMessage]);
    }
    setInput("");
    setError(null);
    setBusy(true);
    setBusyChannel(channel);

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
        const streamSteps: string[] = [];
        const placeholderId = assistantMessageId;

        await new Promise<void>((resolve, reject) => {
          void streamChat(
            text,
            chatSessionId,
            effectiveClientProfileId,
            resolvedMode,
            (step) => {
              if (!placeholderId) return;
              const description = describeStreamStep(step);
              if (!description) return;
              if (streamSteps.includes(description)) return;
              streamSteps.push(description);
              const visibleSteps = streamSteps.slice(-6);
              updateAssistantMessage(placeholderId, (current) => ({
                ...current,
                content: "",
                mode: resolvedMode,
                isStreaming: true,
                streamingLabel: describeStreamingLabel(step.type),
                streamingSteps: visibleSteps,
                traceSteps: [...streamSteps],
              }));
            },
            (response) => {
              void (async () => {
                if (response.sessionId) {
                  try {
                    setChatSessionId(response.sessionId);
                    localStorage.setItem(CHAT_SESSION_STORAGE_KEY, response.sessionId);
                  } catch {}
                }

                if (placeholderId) {
                  await animateAssistantReply(placeholderId, {
                    reply: response.reply,
                    mode: response.mode,
                    structured: response.structured ?? undefined,
                    requestId: response.requestId,
                    agent: response.agent ?? undefined,
                    uiHints: response.uiHints ?? undefined,
                  });
                }

                resolve();
              })().catch(reject);
            },
            (streamError) => {
              reject(new Error(streamError));
            }
          ).catch(reject);
        });
      }
    } catch (requestError) {
      if (assistantMessageId) {
        removeMessage(assistantMessageId);
      }
      setError(requestError instanceof Error ? requestError.message : "请求失败，请稍后再试。");
    } finally {
      setBusy(false);
      setBusyChannel(null);
    }
  }, [activeChatMode, busy, chatSessionId, clientProfileId, configuratorSessionId]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitMessage(input, "chat", activeChatMode);
  }, [activeChatMode, input, submitMessage]);

  const handleNewChat = useCallback(() => {
    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    setMessages([]);
    setInput("");
    setError(null);
    setChatSessionId(null);
    setConfiguratorSessionId(null);
    setConfiguratorState(null);
    setConfiguratorChoices(null);
    try {
      localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
      localStorage.removeItem(CONFIGURATOR_SESSION_STORAGE_KEY);
    } catch {}
  }, []);

  const handleResetConfigurator = useCallback(() => {
    setError(null);
    setConfiguratorState(null);
    setConfiguratorChoices(null);
    setConfiguratorSessionId(null);
    try {
      localStorage.removeItem(CONFIGURATOR_SESSION_STORAGE_KEY);
    } catch {}
  }, []);

  function focusConfiguratorSection() {
    if (typeof document === "undefined") return;
    const section = document.getElementById("configurator-section");
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "#configurator-section");
      window.setTimeout(() => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 180);
    }
    section.classList.add("cfg-section-target");
    window.setTimeout(() => section.classList.remove("cfg-section-target"), 1200);
  }

  const openConfiguratorFlow = useCallback((initialMessage?: string) => {
    setShouldMountConfigurator(true);
    focusConfiguratorSection();
    void submitMessage(initialMessage || "我想开始配置一台更适合我的小鹏汽车。", "configurator");
  }, [submitMessage]);

  const handleConfiguratorAction = useCallback((text: string) => {
    void submitMessage(text, "configurator");
  }, [submitMessage]);

  const openTestDriveModal = useCallback((carName?: string) => {
    setLeadIntent("test_drive");
    setTestDriveCar(carName);
    setTestDriveOpen(true);
  }, []);

  const openAdvisorFollowupModal = useCallback((carName?: string) => {
    setLeadIntent("advisor_followup");
    setTestDriveCar(carName);
    setTestDriveOpen(true);
  }, []);

  const closeTestDriveModal = useCallback(() => {
    setTestDriveOpen(false);
  }, []);

  const openStoreModal = useCallback(() => {
    setStoreOpen(true);
  }, []);

  const closeStoreModal = useCallback(() => {
    setStoreOpen(false);
  }, []);

  const openOfferModal = useCallback(() => {
    setOfferOpen(true);
  }, []);

  const closeOfferModal = useCallback(() => {
    setOfferOpen(false);
  }, []);

  const handleQuickAsk = useCallback((text: string, mode: Exclude<ChatMode, "configurator">) => {
    setActiveChatMode(mode);
    void submitMessage(text, "chat", mode);
  }, [submitMessage]);

  const handleChatFollowup = useCallback((text: string, messageMode?: ChatMode) => {
    void submitMessage(
      text,
      messageMode === "configurator" ? "configurator" : "chat",
      messageMode && messageMode !== "configurator" ? messageMode : activeChatMode
    );
  }, [activeChatMode, submitMessage]);

  return (
    <main className="app-mesh-bg min-h-screen">
      <ChatHeader
        hasMessages={messages.length > 0}
        busy={busy}
        onNewChat={handleNewChat}
        onConfigurator={openConfiguratorFlow}
        onQuickAsk={handleQuickAsk}
      />

      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        {/* ══════════════════════════════════════════════════════════ */}
        {/* AI Agent Chat — NOW ABOVE the Configurator               */}
        {/* ══════════════════════════════════════════════════════════ */}
        <section className="grid gap-6">
          <div className="flex min-h-[50vh] flex-col overflow-hidden rounded-[32px] border border-white/80 bg-white/92 shadow-card">
            <div className="border-b border-ink-100/80 px-5 py-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#b76438]">AI 购车顾问</p>
              <p className="mt-2 text-sm leading-7 text-ink-600">
                先在这里聊需求、做推荐和对比，确定方向后到下方配置器完成选配。
              </p>
            </div>

            <div ref={chatScrollRef} className="chat-scroll flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-dashed border-[#f0c6a8] bg-[#fff8f2] p-6">
                    <p className="text-lg font-semibold text-ink-900">你好！我是小鹏 AI 购车顾问。</p>
                    <p className="mt-2 text-sm text-ink-600">选一个模式开始对话，或直接在下方配置器快速选配。</p>
                    <div className="mt-4 grid gap-3">
                      {QUICK_PROMPTS.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => handleQuickAsk(item.text, item.mode)}
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
                          onTestDrive={openTestDriveModal}
                          onStores={openStoreModal}
                          onOffer={openOfferModal}
                          onAdvisorFollowup={openAdvisorFollowupModal}
                          onFollowup={(text) => handleChatFollowup(text, message.mode)}
                          onConfigurator={openConfiguratorFlow}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {busy && busyChannel === "configurator" ? (
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
                    onClick={() => openConfiguratorFlow()}
                    className="rounded-full border border-[#f3c9a8] bg-[#fff3e8] px-4 py-2 text-sm font-semibold text-[#8f431f] transition hover:bg-[#ffe6d1] disabled:opacity-50"
                  >
                    去做选配
                  </button>
                </div>

                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (input.trim() && !busy) {
                        void submitMessage(input, "chat", activeChatMode);
                      }
                    }
                  }}
                  placeholder={
                    activeChatMode === "recommendation"
                      ? "例如：预算 18 到 22 万，工作日城市通勤，家里有老人和孩子，推荐两款重点试驾车型。"
                      : activeChatMode === "comparison"
                        ? "例如：帮我从空间、智驾、乘坐舒适性和价格，对比 G6 和 G9。"
                        : "例如：第一次买纯电车，家里能装充电桩，冬天续航和补能要注意什么？"
                  }
                  rows={3}
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

        {/* ══════════════════════════════════════════════════════════ */}
        {/* Car Configurator — BELOW the AI chat                     */}
        {/* ══════════════════════════════════════════════════════════ */}
        <div
          id="configurator-section"
          ref={configuratorSectionRef}
          className="scroll-mt-24"
          style={{ contentVisibility: "auto", containIntrinsicSize: "1600px" }}
        >
          <ConfiguratorHero
            ready={shouldMountConfigurator}
            state={configuratorState}
            choices={configuratorChoices}
            busy={configuratorBusy}
            onAction={handleConfiguratorAction}
            onReset={handleResetConfigurator}
            onBookTestDrive={openTestDriveModal}
            onAdvisorFollowup={openAdvisorFollowupModal}
          />
        </div>
      </div>

      {testDriveOpen ? (
        <LazyTestDriveModal
          open={testDriveOpen}
          onClose={closeTestDriveModal}
          carName={testDriveCar}
          intent={leadIntent}
        />
      ) : null}
      {storeOpen ? <LazyStoreModal open={storeOpen} onClose={closeStoreModal} /> : null}
      {offerOpen ? <LazyOfferModal open={offerOpen} onClose={closeOfferModal} /> : null}
    </main>
  );
}
