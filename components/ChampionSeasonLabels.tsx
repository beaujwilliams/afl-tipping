import { championSeasonLabels } from "@/lib/champion-metadata";

type ChampionSeasonLabelsProps = {
  seasons?: number[] | null;
  fontSize?: number;
};

export function ChampionSeasonLabels({
  seasons,
  fontSize = 12,
}: ChampionSeasonLabelsProps) {
  const labels = championSeasonLabels(seasons);
  if (!labels.length) return null;

  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          style={{
            fontSize,
            fontWeight: 400,
            opacity: 0.72,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      ))}
    </>
  );
}
