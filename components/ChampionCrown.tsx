type ChampionCrownProps = {
  isChampion?: boolean;
};

export function ChampionCrown({ isChampion = false }: ChampionCrownProps) {
  if (!isChampion) return null;

  return (
    <span
      role="img"
      aria-label="Reigning champion"
      title="Reigning champion"
      style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}
    >
      👑
    </span>
  );
}
