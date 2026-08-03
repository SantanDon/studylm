export const SOURCE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const SOURCE_UPLOAD_MAX_FILES = 20;
export const SOURCE_UPLOAD_MAX_TOTAL_BYTES = 250 * 1024 * 1024;

export const SOURCE_UPLOAD_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
  ".mp3",
  ".wav",
  ".m4a",
  ".epub",
] as const;

export type RejectedSourceFile = {
  file: File;
  reason: string;
};

const extensionOf = (fileName: string) => {
  const normalized = String(fileName || "")
    .trim()
    .toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 ? normalized.slice(dot) : "";
};

export const validateSourceFiles = (files: File[]) => {
  const accepted: File[] = [];
  const rejected: RejectedSourceFile[] = [];
  const seen = new Set<string>();
  let acceptedBytes = 0;

  for (const file of files) {
    const identity = `${file.name.toLowerCase()}:${file.size}:${file.lastModified}`;
    if (seen.has(identity)) {
      rejected.push({ file, reason: "Duplicate selection" });
      continue;
    }
    seen.add(identity);

    const extension = extensionOf(file.name);
    if (
      !SOURCE_UPLOAD_EXTENSIONS.includes(
        extension as (typeof SOURCE_UPLOAD_EXTENSIONS)[number],
      )
    ) {
      rejected.push({ file, reason: "Unsupported file type" });
      continue;
    }
    if (file.size <= 0) {
      rejected.push({ file, reason: "The file is empty" });
      continue;
    }
    if (file.size > SOURCE_UPLOAD_MAX_BYTES) {
      rejected.push({ file, reason: "Larger than the 50 MB limit" });
      continue;
    }
    if (accepted.length >= SOURCE_UPLOAD_MAX_FILES) {
      rejected.push({ file, reason: "More than the 20-file batch limit" });
      continue;
    }
    if (acceptedBytes + file.size > SOURCE_UPLOAD_MAX_TOTAL_BYTES) {
      rejected.push({ file, reason: "Exceeds the 250 MB batch limit" });
      continue;
    }
    accepted.push(file);
    acceptedBytes += file.size;
  }

  return { accepted, rejected };
};

export const formatUploadSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
