import { describe, expect, it } from 'vitest';
import { allowsH3NativeAudio } from
  '../../apps/studio/src/lib/h3-audio-policy.js';

describe('H3 media audio policy', () => {
  const nativeJob = { id: 'job-native', audio_mode: 'h3_native' as const };
  const silentJob = { id: 'job-silent', audio_mode: 'silent' as const };

  it('allows only video produced by the matching H3 native-audio job', () => {
    expect(allowsH3NativeAudio({ kind: 'video',
      producer_job_id: nativeJob.id }, [nativeJob, silentJob])).toBe(true);
    expect(allowsH3NativeAudio({ kind: 'video',
      producer_job_id: silentJob.id }, [nativeJob, silentJob])).toBe(false);
    expect(allowsH3NativeAudio({ kind: 'video', producer_job_id: null },
      [nativeJob])).toBe(false);
    expect(allowsH3NativeAudio({ kind: 'image',
      producer_job_id: nativeJob.id }, [nativeJob])).toBe(false);
  });
});
