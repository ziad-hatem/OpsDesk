const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

const INDEXABLE_STATIC_PATHS = new Set([
  "/auth/magic-link",
  "/forgot-password",
  "/login",
  "/portal/sign-in",
  "/register",
  "/reset-password",
  "/verify",
]);

function parseStatusSlugs(rawValue) {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((slug) => slug.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

function toSitemapEntry(config, path, changefreq, priority) {
  return {
    loc: path,
    changefreq,
    priority,
    lastmod: new Date().toISOString(),
    alternateRefs: config.alternateRefs ?? [],
  };
}

const statusPaths = parseStatusSlugs(process.env.SITEMAP_STATUS_SLUGS);

/** @type {import('next-sitemap').IConfig} */
const config = {
  siteUrl: SITE_URL,
  generateRobotsTxt: true,
  transform: async (config, path) => {
    if (!INDEXABLE_STATIC_PATHS.has(path)) {
      return null;
    }

    return toSitemapEntry(config, path, "weekly", 0.6);
  },
  additionalPaths: async (config) =>
    statusPaths.map((slug) =>
      toSitemapEntry(config, `/status/${slug}`, "hourly", 0.8),
    ),
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
  },
};

module.exports = config;
