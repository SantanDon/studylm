export default async (req, res) => {
  res.status(200).json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      vercel: !!process.env.VERCEL,
      env: process.env.NODE_ENV
    }
  });
};
