"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";

type CopyToClipboardButtonProps = {
  value: string;
  label: string;
  failureMessage?: string;
  copiedLabel?: string;
};

function copyWithTextarea(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function CopyToClipboardButton({
  value,
  label,
  failureMessage = "Could not copy text.",
  copiedLabel = "Copied",
}: CopyToClipboardButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyValue() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        copyWithTextarea(value);
      }
      setCopied(true);
    } catch {
      setCopied(false);
      toast.error(failureMessage);
    }
  }

  return (
    <div className="ui-recap-copy-actions">
      <button
        type="button"
        onClick={() => void copyValue()}
        className="ui-btn ui-scoring-copy-btn ui-recap-copy-btn"
        aria-label={label}
        title={label}
        disabled={!value.trim()}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="7" y="3" width="10" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3" y="7" width="10" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
      {copied ? <span className="ui-scoring-copy-state">{copiedLabel}</span> : null}
    </div>
  );
}
