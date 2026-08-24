interface PolicyVideoProps {
  allowH3Audio: boolean;
  src: string;
}

export function PolicyVideo({ allowH3Audio, src }: PolicyVideoProps) {
  return <video controls playsInline preload="metadata" src={src}
    muted={!allowH3Audio} onVolumeChange={(event) => {
      if (!allowH3Audio) event.currentTarget.muted = true;
    }} />;
}
