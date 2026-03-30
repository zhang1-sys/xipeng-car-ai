"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  return (
    (window.SpeechRecognition as SpeechRecCtor | undefined) ||
    (window.webkitSpeechRecognition as SpeechRecCtor | undefined) ||
    null
  );
}

export function useVoiceInput(options: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
}) {
  const { onFinal, onInterim } = options;
  const recRef = useRef<SpeechRecognition | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(!!getSpeechRecognition());
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("当前浏览器不支持语音识别。");
      return;
    }

    setError(null);
    if (recRef.current) {
      try {
        recRef.current.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    }

    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]![0]!.transcript;
        if (event.results[i]!.isFinal) finalChunk += piece;
        else interim += piece;
      }

      if (finalChunk.trim()) onFinal(finalChunk.trim());
      if (interim && onInterim) onInterim(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "aborted" || event.error === "no-speech") return;

      const messages: Record<string, string> = {
        "not-allowed": "没有获得麦克风权限，请在浏览器设置中允许访问。",
        "service-not-allowed": "语音服务不可用，请检查 HTTPS 或浏览器支持情况。",
        network: "网络异常，语音识别失败。",
      };

      setError(messages[event.error] || `语音识别错误：${event.error}`);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      recRef.current = null;
    };

    recRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("无法启动语音识别，请重试。");
      setListening(false);
    }
  }, [onFinal, onInterim]);

  return { listening, supported, error, start, stop, clearError: () => setError(null) };
}
