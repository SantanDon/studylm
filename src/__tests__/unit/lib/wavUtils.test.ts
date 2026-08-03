import { describe, expect, it } from "vitest";
import { audioBufferToWav } from "@/lib/tts/wavUtils";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("WAV rendering", () => {
  it("writes one valid PCM16 RIFF container with interleaved stereo samples", async () => {
    const left = new Float32Array([-1, 0.5, 2]);
    const right = new Float32Array([1, -0.5, -2]);
    const buffer = {
      numberOfChannels: 2,
      length: 3,
      sampleRate: 8000,
      duration: 3 / 8000,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;

    const blob = audioBufferToWav(buffer);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe("audio/wav");
    expect(bytes).toHaveLength(44 + 3 * 2 * 2);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(ascii(bytes, 8, 4)).toBe("WAVE");
    expect(ascii(bytes, 12, 4)).toBe("fmt ");
    expect(ascii(bytes, 36, 4)).toBe("data");
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);

    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(16383);
    expect(view.getInt16(50, true)).toBe(-16384);
    expect(view.getInt16(52, true)).toBe(32767);
    expect(view.getInt16(54, true)).toBe(-32768);

    const riffMarkers = Array.from(bytes)
      .map((_, index) => ascii(bytes, index, 4) === "RIFF")
      .filter(Boolean);
    expect(riffMarkers).toHaveLength(1);
  });

  it("bounds output to two channels even when the source has surround audio", async () => {
    const channel = new Float32Array([0.25, -0.25]);
    const buffer = {
      numberOfChannels: 6,
      length: 2,
      sampleRate: 48000,
      duration: 2 / 48000,
      getChannelData: () => channel,
    } as AudioBuffer;

    const bytes = new Uint8Array(await audioBufferToWav(buffer).arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(8);
  });
});
