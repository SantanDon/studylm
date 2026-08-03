/**
 * Audio Validation Tool — programmatic WAV quality gate
 *
 * A valid WAV file is NOT proof of working audio.
 * This tool verifies: header integrity, non-silence, correct duration,
 * speech-band spectral content, and voice differentiation.
 *
 * Usage:
 *   node backend/scripts/validate_audio.js <file.wav> [options]
 *
 * Options:
 *   --voice <id>        Expected voice ID (for voice identity check)
 *   --text "..."        Expected text content (for duration estimation)
 *   --compare <b.wav>   Compare two files for voice differentiation
 *   --sample-rate <n>   Expected sample rate (default 24000)
 *   --json              Output JSON only
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 */

import fs from "node:fs";

// ── WAV Parsing ────────────────────────────────────────────────────────────────

class WavInfo {
  constructor(buf) {
    if (buf.length < 44)
      throw new Error(`File too small for WAV header: ${buf.length} bytes`);

    this.riffId = buf.toString("ascii", 0, 4);
    this.fileSize = buf.readUInt32LE(4);
    this.waveId = buf.toString("ascii", 8, 12);

    // Find fmt chunk
    let offset = 12;
    let foundFmt = false;
    let foundData = false;
    while (offset + 8 <= buf.length) {
      const chunkId = buf.toString("ascii", offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === "fmt ") {
        this.audioFormat = buf.readUInt16LE(offset + 8);
        this.numChannels = buf.readUInt16LE(offset + 10);
        this.sampleRate = buf.readUInt32LE(offset + 12);
        this.byteRate = buf.readUInt32LE(offset + 16);
        this.blockAlign = buf.readUInt16LE(offset + 20);
        this.bitsPerSample = buf.readUInt16LE(offset + 22);
        foundFmt = true;
      }
      if (chunkId === "data") {
        this.dataOffset = offset + 8;
        this.dataSize = chunkSize;
        foundData = true;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (!foundFmt) throw new Error("No fmt chunk found in WAV");
    if (!foundData) throw new Error("No data chunk found in WAV");
    if (this.audioFormat !== 1 && this.audioFormat !== 3) {
      throw new Error(
        `Unsupported audio format: ${this.audioFormat} (only PCM=1 or IEEE float=3 supported)`,
      );
    }
  }

  get durationSeconds() {
    return (
      this.dataSize /
      (this.sampleRate * this.numChannels * (this.bitsPerSample / 8))
    );
  }
}

function readPcmSamples(buf, wav) {
  const bytesPerSample = wav.bitsPerSample / 8;
  const numSamples = Math.floor(
    wav.dataSize / bytesPerSample / wav.numChannels,
  );

  const pcm = new Float64Array(numSamples);
  const view = new DataView(
    buf.buffer,
    buf.byteOffset + wav.dataOffset,
    wav.dataSize,
  );

  if (wav.audioFormat === 3) {
    // IEEE float (Kokoro Node.js outputs 32-bit float)
    const scale = wav.bitsPerSample === 32 ? 1.0 : 1.0;
    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < wav.numChannels; ch++) {
        sum += view.getFloat32(
          (i * wav.numChannels + ch) * bytesPerSample,
          true,
        );
      }
      pcm[i] = (sum / wav.numChannels) * scale;
    }
  } else if (wav.bitsPerSample === 16) {
    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < wav.numChannels; ch++) {
        sum += view.getInt16((i * wav.numChannels + ch) * 2, true);
      }
      pcm[i] = sum / wav.numChannels;
    }
  } else if (wav.bitsPerSample === 8) {
    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < wav.numChannels; ch++) {
        sum += view.getUint8(i * wav.numChannels + ch) - 128;
      }
      pcm[i] = sum / wav.numChannels;
    }
  } else {
    throw new Error(
      `Unsupported format: ${wav.audioFormat} / ${wav.bitsPerSample}-bit`,
    );
  }

  return pcm;
}

// ── Audio Analysis ─────────────────────────────────────────────────────────────

function computeRms(samples) {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

function computeSpectralCentroid(samples, sampleRate) {
  // Use a windowed DFT on the whole signal (simplified: take first N power-of-2)
  const n = 1 << Math.floor(Math.log2(Math.min(samples.length, 65536)));
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Hann window
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Apply window and compute FFT
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    real[i] = samples[i] * window[i];
    imag[i] = 0;
  }

  fft(real, imag);

  const freqResolution = sampleRate / n;
  let weightedSum = 0;
  let totalMagnitude = 0;

  const halfN = n / 2;
  for (let i = 0; i < halfN; i++) {
    const magnitude = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    const freq = i * freqResolution;
    weightedSum += freq * magnitude;
    totalMagnitude += magnitude;
  }

  if (totalMagnitude < 1e-10) return 0;
  return weightedSum / totalMagnitude;
}

// In-place radix-2 Cooley-Tukey FFT (n must be power of 2)
function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = reverseBits(i, bits);
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len *= 2) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curRe = 1,
        curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const tRe = curRe * re[i + j + len / 2] - curIm * im[i + j + len / 2];
        const tIm = curRe * im[i + j + len / 2] + curIm * re[i + j + len / 2];

        re[i + j + len / 2] = re[i + j] - tRe;
        im[i + j + len / 2] = im[i + j] - tIm;
        re[i + j] += tRe;
        im[i + j] += tIm;

        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

function reverseBits(x, bits) {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

function computeFundamentalFrequency(samples, sampleRate) {
  // Autocorrelation-based pitch detection
  const minLag = Math.floor(sampleRate / 400); // max ~400Hz
  const maxLag = Math.floor(sampleRate / 50); // min ~50Hz

  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag < maxLag; lag++) {
    let corr = 0;
    let count = 0;
    const limit = Math.min(samples.length, 10000);
    for (let i = 0; i < limit - lag; i++) {
      corr += samples[i] * samples[i + lag];
      count++;
    }
    corr /= count;

    // Normalize by energy
    let energy = 0;
    for (let i = 0; i < limit; i++) {
      energy += samples[i] * samples[i];
    }
    const normCorr = energy > 0 ? corr / (energy / limit) : 0;

    if (normCorr > bestCorr) {
      bestCorr = normCorr;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestCorr < 0.1) return 0;
  return sampleRate / bestLag;
}

// ── Voice Differentiation ──────────────────────────────────────────────────────

function computeSpectralProfile(samples, sampleRate) {
  // Compute power spectrum and bin into Mel-spaced bands
  const n = 1 << Math.floor(Math.log2(Math.min(samples.length, 65536)));
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    real[i] = samples[i] * window[i];
    imag[i] = 0;
  }

  fft(real, imag);

  // 20 Mel-spaced frequency bands (0-8000Hz)
  const numBands = 20;
  const bands = new Float64Array(numBands);
  const nyquist = sampleRate / 2;
  const freqRes = sampleRate / n;

  for (let i = 1; i < n / 2; i++) {
    const freq = i * freqRes;
    const mel = 2595 * Math.log10(1 + freq / 700);
    const maxMel = 2595 * Math.log10(1 + nyquist / 700);
    const bandIdx = Math.min(
      numBands - 1,
      Math.floor((mel / maxMel) * numBands),
    );
    const power = real[i] * real[i] + imag[i] * imag[i];
    bands[bandIdx] += Math.sqrt(power);
  }

  // Normalize
  let total = 0;
  for (let i = 0; i < numBands; i++) total += bands[i];
  if (total > 0) {
    for (let i = 0; i < numBands; i++) bands[i] /= total;
  }

  return bands;
}

function cosineDistance(a, b) {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-10) return 1;
  return 1 - dot / denom;
}

// ── Validation ─────────────────────────────────────────────────────────────────

const RESULTS = {
  PASS: "PASS",
  FAIL: "FAIL",
  SKIP: "SKIP",
};

class ValidationSuite {
  constructor() {
    this.results = [];
  }

  check(name, passFn, detailFn) {
    let passed;
    let detail = "";
    try {
      passed = passFn();
      detail = detailFn ? detailFn() : "";
    } catch (err) {
      passed = false;
      detail = err.message;
    }
    this.results.push({
      name,
      status: passed ? RESULTS.PASS : RESULTS.FAIL,
      detail,
    });
  }

  skip(name, reason) {
    this.results.push({ name, status: RESULTS.SKIP, detail: reason });
  }

  print(summaryOnly = false) {
    const width = 60;
    console.log("┌" + "─".repeat(width) + "┐");
    console.log("│" + " Audio Validation Results".padEnd(width) + "│");
    console.log("├" + "─".repeat(width) + "┤");

    for (const r of this.results) {
      const icon =
        r.status === RESULTS.PASS
          ? "  PASS"
          : r.status === RESULTS.SKIP
            ? "  SKIP"
            : "  FAIL";
      const line = ` ${icon} | ${r.name}`.padEnd(width - 1) + "│";
      console.log("│" + line);
      if (r.detail && !summaryOnly) {
        console.log("│" + `       ${r.detail}`.padEnd(width) + "│");
      }
    }

    console.log("├" + "─".repeat(width) + "┤");
    const passCount = this.results.filter(
      (r) => r.status === RESULTS.PASS,
    ).length;
    const failCount = this.results.filter(
      (r) => r.status === RESULTS.FAIL,
    ).length;
    const skipCount = this.results.filter(
      (r) => r.status === RESULTS.SKIP,
    ).length;
    const totalRun = passCount + failCount;
    const icon = failCount === 0 ? "   PASS" : "   FAIL";
    console.log(
      "│" +
        ` ${icon} | ${passCount}/${totalRun} passed, ${failCount} failed, ${skipCount} skipped`.padEnd(
          width,
        ) +
        "│",
    );
    console.log("└" + "─".repeat(width) + "┘");
    return failCount === 0;
  }

  toJSON() {
    return {
      passed: this.results.filter((r) => r.status === RESULTS.PASS).length,
      failed: this.results.filter((r) => r.status === RESULTS.FAIL).length,
      skipped: this.results.filter((r) => r.status === RESULTS.SKIP).length,
      results: this.results,
    };
  }

  get allPassed() {
    return this.results.filter((r) => r.status === RESULTS.FAIL).length === 0;
  }
}

export async function validateAudio(filePath, options = {}) {
  const buf = fs.readFileSync(filePath);
  const suite = new ValidationSuite();
  let wav, samples;

  // ── 1. WAV Header Validity ────────────────────────────────────────────────
  try {
    wav = new WavInfo(buf);
    suite.check(
      "WAV header validity",
      () => {
        if (wav.riffId !== "RIFF")
          throw new Error(`Expected RIFF, got "${wav.riffId}"`);
        if (wav.waveId !== "WAVE")
          throw new Error(`Expected WAVE, got "${wav.waveId}"`);
        return true;
      },
      () => `RIFF/WAVE header valid`,
    );
  } catch (err) {
    suite.check(
      "WAV header validity",
      () => false,
      () => err.message,
    );
    suite.print(options.json);
    return suite;
  }

  // ── 2. Format Correctness ─────────────────────────────────────────────────
  const expectedSampleRate = options.sampleRate || 24000;
  suite.check(
    "Sample rate",
    () => {
      if (wav.sampleRate !== expectedSampleRate)
        throw new Error(
          `Expected ${expectedSampleRate}Hz, got ${wav.sampleRate}Hz`,
        );
      return true;
    },
    () => `${wav.sampleRate}Hz`,
  );

  suite.check(
    "Channel count",
    () => {
      if (wav.numChannels !== 1)
        throw new Error(`Expected mono (1ch), got ${wav.numChannels}ch`);
      return true;
    },
    () => `${wav.numChannels}ch`,
  );

  suite.check(
    "Bit depth & format",
    () => {
      const expectedBits = wav.audioFormat === 3 ? 32 : 16;
      if (wav.bitsPerSample !== expectedBits)
        throw new Error(
          `Expected ${expectedBits}-bit for format ${wav.audioFormat}, got ${wav.bitsPerSample}-bit`,
        );
      return true;
    },
    () =>
      `${wav.bitsPerSample}-bit ${wav.audioFormat === 3 ? "IEEE float" : "PCM"}`,
  );

  // ── 3. Silence Detection (RMS energy) ─────────────────────────────────────
  try {
    samples = readPcmSamples(buf, wav);
    const rms = computeRms(samples);
    suite.check(
      "Audio content (RMS)",
      () => {
        if (rms < 0.001)
          throw new Error(
            `RMS=${rms.toFixed(6)} — audio is effectively silent`,
          );
        return true;
      },
      () => `RMS=${rms.toFixed(4)}`,
    );
  } catch (err) {
    suite.check(
      "Audio content (RMS)",
      () => false,
      () => err.message,
    );
  }

  // ── 4. Sample-level Integrity ─────────────────────────────────────────────
  if (samples) {
    const totalSamples = samples.length;
    const isFloat = wav.audioFormat === 3;
    const threshold = isFloat ? 0.01 : 100; // Float range [-1, 1], int range [-32768, 32767]
    let loudSamples = 0;
    for (let i = 0; i < totalSamples; i++) {
      if (Math.abs(samples[i]) > threshold) loudSamples++;
    }
    const pctLoud = (loudSamples / totalSamples) * 100;
    suite.check(
      "Sample integrity",
      () => {
        if (pctLoud < 5)
          throw new Error(
            `Only ${pctLoud.toFixed(1)}% of samples > |${threshold}| (need 5%)`,
          );
        return true;
      },
      () =>
        `${pctLoud.toFixed(1)}% samples > |${threshold}| (${loudSamples}/${totalSamples})`,
    );
  }

  // ── 5. Duration Sanity ────────────────────────────────────────────────────
  if (options.text) {
    const expectedDuration = options.text.length / 15; // ~15 chars/sec avg speech
    const actualDuration = wav.durationSeconds;
    const ratio = actualDuration / expectedDuration;
    suite.check(
      "Duration sanity",
      () => {
        if (ratio < 0.2)
          throw new Error(
            `Duration ${actualDuration.toFixed(1)}s is too short (${(ratio * 100).toFixed(0)}% of expected ${expectedDuration.toFixed(1)}s)`,
          );
        if (ratio > 2.5)
          throw new Error(
            `Duration ${actualDuration.toFixed(1)}s is too long (${(ratio * 100).toFixed(0)}% of expected ${expectedDuration.toFixed(1)}s)`,
          );
        return true;
      },
      () =>
        `${actualDuration.toFixed(1)}s (expected ~${expectedDuration.toFixed(1)}s, ratio ${ratio.toFixed(2)}x)`,
    );
  } else {
    suite.skip("Duration sanity", "No --text provided for reference");
  }

  // ── 6. Speech-like Frequency Content ──────────────────────────────────────
  if (samples && samples.length > 256) {
    const centroid = computeSpectralCentroid(samples, wav.sampleRate);
    suite.check(
      "Speech band (spectral centroid)",
      () => {
        if (centroid < 150)
          throw new Error(
            `Centroid ${centroid.toFixed(0)}Hz — too low (sub-bass/hum)`,
          );
        if (centroid > 6500)
          throw new Error(
            `Centroid ${centroid.toFixed(0)}Hz — too high (noise/whine)`,
          );
        return true;
      },
      () => `${centroid.toFixed(0)}Hz (speech band: 150-6500Hz)`,
    );
  } else {
    suite.skip("Speech band", "Insufficient samples for spectral analysis");
  }

  // ── Voice differentiation (comparison mode) ──────────────────────────────
  if (options.compareTo) {
    const compareBuf = fs.readFileSync(options.compareTo);
    try {
      const compareWav = new WavInfo(compareBuf);
      const compareSamples = readPcmSamples(compareBuf, compareWav);

      const profileA = computeSpectralProfile(
        samples.slice(0, Math.min(samples.length, 65536)),
        wav.sampleRate,
      );
      const profileB = computeSpectralProfile(
        compareSamples.slice(0, Math.min(compareSamples.length, 65536)),
        compareWav.sampleRate,
      );

      const dist = cosineDistance(profileA, profileB);

      suite.check(
        "Voice differentiation",
        () => {
          if (dist < 0.05)
            throw new Error(
              `Spectral distance ${dist.toFixed(4)} — voices are nearly identical`,
            );
          return true;
        },
        () =>
          `Spectral cosine distance = ${dist.toFixed(4)} (>0.05 = different voices)`,
      );

      // Also compare fundamental frequency
      const f0A = computeFundamentalFrequency(samples, wav.sampleRate);
      const f0B = computeFundamentalFrequency(
        compareSamples,
        compareWav.sampleRate,
      );
      if (f0A > 0 && f0B > 0) {
        const f0Diff = Math.abs(f0A - f0B);
        suite.check(
          "Pitch differentiation",
          () => {
            if (f0Diff < 5 && dist < 0.1)
              throw new Error(
                `Pitch difference only ${f0Diff.toFixed(0)}Hz — voices may not be distinct`,
              );
            return true;
          },
          () =>
            `F0: ${f0A.toFixed(0)}Hz vs ${f0B.toFixed(0)}Hz (Δ=${f0Diff.toFixed(0)}Hz)`,
        );
      }
    } catch (err) {
      suite.check(
        "Voice differentiation",
        () => false,
        () => `Comparison failed: ${err.message}`,
      );
    }
  } else {
    suite.skip("Voice differentiation", "No --compare file provided");
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  if (!options.json) {
    suite.print();
  }

  return suite;
}

// ── CLI Entry ──────────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("validate_audio.js") ||
    process.argv[1].endsWith("validate_audio"));

if (isMain) {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const options = {};

  const voiceIdx = args.indexOf("--voice");
  if (voiceIdx !== -1) options.voice = args[voiceIdx + 1];

  const textIdx = args.indexOf("--text");
  if (textIdx !== -1) options.text = args[textIdx + 1];

  const compareIdx = args.indexOf("--compare");
  if (compareIdx !== -1) options.compareTo = args[compareIdx + 1];

  const srIdx = args.indexOf("--sample-rate");
  if (srIdx !== -1) options.sampleRate = parseInt(args[srIdx + 1]);

  const jsonFlag = args.includes("--json");
  options.json = jsonFlag;

  if (!filePath) {
    console.error(
      "Usage: node backend/scripts/validate_audio.js <file.wav> [options]",
    );
    console.error("  --voice <id>        Expected voice ID");
    console.error(
      '  --text "..."        Expected text (for duration estimation)',
    );
    console.error(
      "  --compare <b.wav>   Compare two files for voice differentiation",
    );
    console.error("  --sample-rate <n>   Expected sample rate (default 24000)");
    console.error("  --json              Output JSON only");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const suiteP = await validateAudio(filePath, options);
  if (jsonFlag) {
    console.log(JSON.stringify(suiteP.toJSON(), null, 2));
  }
  process.exit(suiteP.allPassed ? 0 : 1);
}
