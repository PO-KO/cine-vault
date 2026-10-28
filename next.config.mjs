/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    '*.run.app',
    'ais-dev-ublnqpms4inhznrpv5pknj-313295835743.europe-west2.run.app',
    'ais-pre-ublnqpms4inhznrpv5pknj-313295835743.europe-west2.run.app',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 's4.anilist.co', pathname: '/**' },
      { protocol: 'https', hostname: 'image.tmdb.org', pathname: '/**' },
      { protocol: 'https', hostname: 'static.tvmaze.com', pathname: '/**' },
      { protocol: 'https', hostname: 'm.media-amazon.com', pathname: '/**' },
      { protocol: 'https', hostname: 'upload.wikimedia.org', pathname: '/**' },
    ],
  },
};

export default nextConfig;
