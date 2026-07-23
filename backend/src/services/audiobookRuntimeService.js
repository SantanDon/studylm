export const getAudiobookRuntimeCapabilities = ({
  isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL),
} = {}) => {
  const enabled = !isVercel;

  return {
    enabled,
    localBeta: isVercel,
    bookIngestion: enabled,
    chapterPreview: enabled,
    fullGeneration: enabled,
    durableJobs: enabled,
    reason: enabled
      ? null
      : 'Audiobook creation currently requires the local StudyPod runtime. Durable cloud rendering and storage are not connected yet.',
  };
};

export const requireAudiobookRuntime = (capabilities) => (_req, res, next) => {
  if (capabilities.enabled) {
    next();
    return;
  }

  res.status(503).json({
    error: 'Audiobook creation is currently available in the local StudyPod app.',
    code: 'AUDIOBOOK_LOCAL_BETA',
    capabilities,
  });
};
