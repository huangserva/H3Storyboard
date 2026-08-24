import type { Asset, H3Job } from '@h3storyboard/protocol';

export function allowsH3NativeAudio(
  asset: Pick<Asset, 'kind' | 'producer_job_id'>,
  jobs: ReadonlyArray<Pick<H3Job, 'id' | 'audio_mode'>>,
): boolean {
  if (asset.kind !== 'video' || !asset.producer_job_id) return false;
  return jobs.some(({ id, audio_mode }) =>
    id === asset.producer_job_id && audio_mode === 'h3_native');
}
