export async function mapWithConcurrency<T, Result>(
  items: readonly T[],
  requestedLimit: number,
  mapper: (item: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(items.length, Math.floor(requestedLimit)));
  const results = new Array<Result>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
