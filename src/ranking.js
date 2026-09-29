// 동점 규칙: 표 수가 같은 선택지는 공동 순위다(1, 1, 3 …).
// 공동 순위끼리는 앞뒤를 정할 수 없으므로 [rank, rank + 동점 수 - 1] 안의 어느 자리로 예측해도 정답으로 본다.

export function orderedResults(round, counts) {
  const items = round.options
    .map((option) => ({ ...option, count: counts[option.id] || 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
  return items.map((item) => {
    const higher = items.filter((other) => other.count > item.count).length;
    const same = items.filter((other) => other.count === item.count).length;
    return { ...item, rank: higher + 1, tied: same > 1 };
  });
}

export function positionRange(counts, optionId) {
  if (!(optionId in counts)) return null;
  const own = counts[optionId];
  const values = Object.values(counts);
  const higher = values.filter((value) => value > own).length;
  const same = values.filter((value) => value === own).length;
  return { first: higher + 1, last: higher + same };
}

export function canBeAt(counts, optionId, position) {
  const range = positionRange(counts, optionId);
  return Boolean(range) && range.first <= position && position <= range.last;
}

export function leaderIds(counts) {
  const values = Object.values(counts);
  if (!values.length) return [];
  const max = Math.max(...values);
  return Object.keys(counts).filter((optionId) => counts[optionId] === max);
}

export function topCount(counts) {
  const values = Object.values(counts);
  return values.length ? Math.max(...values) : 0;
}

export function topGap(counts) {
  const [first = 0, second = 0] = Object.values(counts).sort((a, b) => b - a);
  return first - second;
}

export function gapBucket(first, second) {
  const gap = Math.abs((first?.count || 0) - (second?.count || 0));
  return gap <= 2 ? 'close' : gap <= 5 ? 'middle' : 'wide';
}
