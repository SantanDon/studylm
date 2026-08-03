function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const frameCount = buffer.length;
  const dataBytes = frameCount * channels * 2;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const channelData = Array.from({ length: channels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(
        -1,
        Math.min(1, channelData[channel][frame] || 0),
      );
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  return new Blob([output], { type: "audio/wav" });
}

export async function combineWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0)
    throw new Error("At least one audio segment is required.");

  const decodeContext = new AudioContext();
  let decoded: AudioBuffer[];
  try {
    decoded = await Promise.all(
      blobs.map(async (blob) =>
        decodeContext.decodeAudioData(await blob.arrayBuffer()),
      ),
    );
  } finally {
    await decodeContext.close();
  }

  const sampleRate = Math.max(...decoded.map((buffer) => buffer.sampleRate));
  const channels = Math.max(
    ...decoded.map((buffer) => Math.min(2, buffer.numberOfChannels)),
  );
  const totalFrames = Math.max(
    1,
    Math.ceil(
      decoded.reduce((seconds, buffer) => seconds + buffer.duration, 0) *
        sampleRate,
    ),
  );
  const offline = new OfflineAudioContext(channels, totalFrames, sampleRate);

  let cursorSeconds = 0;
  for (const buffer of decoded) {
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(cursorSeconds);
    cursorSeconds += buffer.duration;
  }

  return audioBufferToWav(await offline.startRendering());
}
