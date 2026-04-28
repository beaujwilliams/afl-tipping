type UnpaidTagProps = {
  paymentStatus?: string | null;
  compact?: boolean;
};

function normalizePaymentStatus(status: string | null | undefined) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return null;
}

export function UnpaidTag({ paymentStatus, compact = false }: UnpaidTagProps) {
  if (normalizePaymentStatus(paymentStatus) !== "pending") return null;

  return (
    <span
      title="unpaid"
      style={{
        fontSize: compact ? 9 : 10,
        fontWeight: 900,
        letterSpacing: 0.25,
        textTransform: "uppercase",
        color: "var(--tone-danger-text)",
        background: "var(--tone-danger-bg)",
        border: "1px solid rgba(180, 35, 24, 0.35)",
        borderRadius: 999,
        padding: compact ? "2px 5px" : "2px 7px",
        lineHeight: 1.1,
        flexShrink: 0,
      }}
    >
      {compact ? "unp" : "unpaid"}
    </span>
  );
}
