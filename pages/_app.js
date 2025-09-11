export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <style jsx global>{`
        :root {
          --bg: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --card: #ffffff;
          --border: #e5e7eb;
          --accent: #2563eb;
          --accent-weak: #eff6ff;
          --code: #0f172a;
        }
        html, body, #__next { height: 100%; }
        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        .wrap { max-width: 860px; margin: 48px auto; padding: 0 20px; }
        .headline {
          margin: 0 0 18px;
          font-size: 28px;
          line-height: 1.25;
          letter-spacing: -0.01em;
        }
        .subhead {
          display: flex; gap: 10px; flex-wrap: wrap;
          padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; background: #fff;
        }
        .badge {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 13px; color: var(--muted);
          padding: 6px 10px; border: 1px solid var(--border); border-radius: 999px; background: #fff;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
        }
        .question {
          font-size: 18px;
          line-height: 1.55;
          margin: 0 0 12px;
        }
        .input, .textarea {
          width: 100%; border: 1px solid var(--border); border-radius: 8px;
          padding: 12px 12px; font-size: 16px; line-height: 1.45;
        }
        .textarea { resize: vertical; min-height: 56px; }
        .btn {
          appearance: none; border: none; cursor: pointer;
          background: var(--accent); color: #fff; border-radius: 8px;
          padding: 10px 14px; font-size: 15px; font-weight: 600;
        }
        .btn:disabled { opacity: .6; cursor: not-allowed; }
        .btn-secondary {
          background: #fff; color: var(--text); border: 1px solid var(--border);
        }
        .probe {
          background: var(--accent-weak);
          border: 1px solid #dbeafe;
          color: #1e40af;
          padding: 10px 12px; border-radius: 8px;
          font-style: italic;
        }
        .debug {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          background: #0b1220; color: #d1e0ff; border-radius: 8px; padding: 12px;
          white-space: pre-wrap; overflow: auto; max-height: 280px;
        }
        .historyItem { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 10px; }
        .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
        .spacer { height: 8px; }
        .muted { color: var(--muted); }
        a.link { color: var(--accent); text-decoration: none; }
      `}</style>
    </>
  );
}
