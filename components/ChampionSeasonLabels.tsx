import { championSeasonLabels } from "@/lib/champion-metadata";

type ChampionSeasonLabelsProps = {
  seasons?: number[] | null;
};

export function ChampionSeasonLabels({ seasons }: ChampionSeasonLabelsProps) {
  const labels = championSeasonLabels(seasons);
  if (!labels.length) return null;

  return (
    <>
      {labels.map((label) => (
        <span
          key={label}
          style={{
            fontSize: 12,
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
