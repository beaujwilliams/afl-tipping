type UnpaidTagProps = {
  paymentStatus?: string | null;
};

function normalizePaymentStatus(status: string | null | undefined) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (s === "paid" || s === "pending" || s === "waived") return s;
  return null;
}

export function UnpaidTag({ paymentStatus }: UnpaidTagProps) {
  if (normalizePaymentStatus(paymentStatus) !== "pending") return null;

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: 0.25,
        textTransform: "uppercase",
        color: "#b42318",
        background: "rgba(180, 35, 24, 0.12)",
        border: "1px solid rgba(180, 35, 24, 0.35)",
        borderRadius: 999,
        padding: "2px 7px",
        lineHeight: 1.1,
      }}
    >
      unpaid
    </span>
  );
}
