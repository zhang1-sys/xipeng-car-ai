import ReactMarkdown from "react-markdown";

export function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown
      className="prose-chat text-sm leading-relaxed text-ink-800 dark:text-slate-200"
      components={{
        p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
        h2: ({ children }) => (
          <h2 className="mb-2 mt-4 text-base font-bold text-ink-900 first:mt-0 dark:text-slate-100">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1.5 mt-3 text-sm font-bold text-ink-900 first:mt-0 dark:text-slate-100">
            {children}
          </h3>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-4 border-sky-300 bg-sky-50/50 py-2 pl-4 pr-3 text-ink-700 dark:border-sky-600 dark:bg-sky-950/40 dark:text-slate-300">
            {children}
          </blockquote>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 list-disc space-y-1.5 pl-5 marker:text-sky-500 dark:marker:text-sky-400">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-brand-dark dark:marker:text-sky-400">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed dark:text-slate-300">{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-ink-900 dark:text-slate-100">
            {children}
          </strong>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-dark underline decoration-sky-300 underline-offset-2 transition hover:text-sky-700 dark:text-sky-400 dark:decoration-sky-500 dark:hover:text-sky-300"
          >
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = /language-\w+/.test(String(className || ""));
          if (!isBlock) {
            return (
              <code
                className="rounded-md bg-ink-100/90 px-1.5 py-0.5 font-mono text-[12px] text-ink-800 dark:bg-slate-800 dark:text-sky-100"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-3 overflow-x-auto rounded-xl border border-ink-800 bg-ink-900 p-3 font-mono text-[12px] leading-relaxed text-sky-100 shadow-inner-glow dark:border-slate-700 dark:bg-slate-950">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
