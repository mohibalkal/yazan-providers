import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

import { MovieData, VideoLinks } from './types';
import { extractTitleAndYear, generateRandomFavs, parseSubtitleLinks, parseVideoLinks } from './utils';

// قائمة النطاقات المتاحة
const domains = [
  'https://hdrezka.ag',
  'https://hdrzk.org',
  'https://hdrezka.me',
  'https://rezka.ag',
  'https://rezka.ws',
];

const baseHeaders = {
  'X-Hdrezka-Android-App': '1',
  'X-Hdrezka-Android-App-Version': '2.2.0',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

async function tryDomains<T>(
  ctx: ShowScrapeContext | MovieScrapeContext,
  action: (baseUrl: string) => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;

  for (const domain of domains) {
    try {
      return await action(domain);
    } catch (error) {
      lastError = error as Error;
      continue;
    }
  }

  throw lastError || new NotFoundError('All domains failed');
}

async function searchAndFindMediaId(ctx: ShowScrapeContext | MovieScrapeContext): Promise<MovieData> {
  const itemRegexPattern = /<a href="([^"]+)"><span class="enty">([^<]+)<\/span> \(([^)]+)\)/g;
  const idRegexPattern = /\/(\d+)-[^/]+\.html$/;

  return tryDomains(ctx, async (baseUrl) => {
    ctx.progress(10);

    const searchData = await ctx.proxiedFetcher<string>('/engine/ajax/search.php', {
      baseUrl,
      headers: baseHeaders,
      query: { q: ctx.media.title },
    });

    const movieData: MovieData[] = [];

    for (const match of searchData.matchAll(itemRegexPattern)) {
      const url = match[1];
      const titleAndYear = match[3];

      const result = extractTitleAndYear(titleAndYear);
      if (!result) continue;

      const id = url.match(idRegexPattern)?.[1];
      if (!id) continue;

      movieData.push({
        id,
        year: result.year || 0,
        type: ctx.media.type,
        url,
      });
    }

    ctx.progress(30);

    // تحسين عملية الفلترة
    const exactMatches = movieData.filter(
      (item): item is MovieData =>
        item.type === ctx.media.type &&
        item.year === ctx.media.releaseYear &&
        typeof item.id === 'string' &&
        typeof item.url === 'string',
    );

    if (exactMatches.length > 0) {
      return exactMatches[0];
    }

    // إذا لم نجد تطابقاً تاماً، نبحث عن تطابق جزئي
    const partialMatches = movieData.filter(
      (item): item is MovieData =>
        item.type === ctx.media.type &&
        item.year === ctx.media.releaseYear &&
        typeof item.id === 'string' &&
        typeof item.url === 'string',
    );

    if (partialMatches.length === 0) {
      throw new NotFoundError('No matching media found');
    }

    return partialMatches[0];
  });
}

async function getTranslatorId(
  url: string,
  id: string,
  ctx: ShowScrapeContext | MovieScrapeContext,
  baseUrl: string,
): Promise<string> {
  ctx.progress(40);

  const response = await ctx.proxiedFetcher<string>(url, {
    baseUrl,
    headers: baseHeaders,
  });

  // البحث عن معرفات المترجمين بالترتيب
  const translatorIds = [
    '238', // Original + subtitles
    '245', // Multi-subtitles
    '239', // Original
  ];

  // البحث عن المعرفات المفضلة أولاً
  for (const preferredId of translatorIds) {
    if (response.includes(`data-translator_id="${preferredId}"`)) {
      return preferredId;
    }
  }

  // البحث في سكريبت التهيئة
  const functionName = ctx.media.type === 'movie' ? 'initCDNMoviesEvents' : 'initCDNSeriesEvents';
  const regexPattern = new RegExp(`sof\\.tv\\.${functionName}\\(${id}, ([^,]+)`, 'i');
  const match = response.match(regexPattern);
  if (match?.[1]) {
    return match[1];
  }

  // البحث عن أي معرف مترجم متاح
  const translatorMatch = response.match(/data-translator_id="(\d+)"/);
  if (translatorMatch?.[1]) {
    return translatorMatch[1];
  }

  throw new NotFoundError('No translator id found');
}

async function getStream(
  id: string,
  translatorId: string,
  ctx: ShowScrapeContext | MovieScrapeContext,
  baseUrl: string,
): Promise<VideoLinks> {
  const searchParams = new URLSearchParams();
  searchParams.append('id', id);
  searchParams.append('translator_id', translatorId);

  if (ctx.media.type === 'show') {
    searchParams.append('season', ctx.media.season.number.toString());
    searchParams.append('episode', ctx.media.episode.number.toString());
  }

  if (ctx.media.type === 'movie') {
    searchParams.append('is_camrip', '0');
    searchParams.append('is_ads', '0');
    searchParams.append('is_director', '0');
  }

  searchParams.append('favs', generateRandomFavs());
  searchParams.append('action', ctx.media.type === 'show' ? 'get_stream' : 'get_movie');

  ctx.progress(60);

  const response = await ctx.proxiedFetcher<string>('/ajax/get_cdn_series/', {
    baseUrl,
    method: 'POST',
    body: searchParams,
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  try {
    return JSON.parse(response);
  } catch {
    throw new NotFoundError('Invalid stream response');
  }
}

const universalScraper = async (ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> => {
  const result = await searchAndFindMediaId(ctx);
  if (!result || typeof result.id !== 'string' || typeof result.url !== 'string') {
    throw new NotFoundError('Invalid media data');
  }

  return tryDomains(ctx, async (baseUrl) => {
    const translatorId = await getTranslatorId(result.url, result.id as string, ctx, baseUrl);

    ctx.progress(70);
    const { url: streamUrl, subtitle: streamSubtitle } = await getStream(
      result.id as string,
      translatorId,
      ctx,
      baseUrl,
    );

    if (!streamUrl) {
      throw new NotFoundError('No stream URL found');
    }

    const parsedVideos = parseVideoLinks(streamUrl);
    const parsedSubtitles = parseSubtitleLinks(streamSubtitle);

    ctx.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: 'primary',
          type: 'file',
          flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
          captions: parsedSubtitles,
          qualities: parsedVideos,
        },
      ],
    };
  });
};

export const hdRezkaScraper = makeSourcerer({
  id: 'hdrezka',
  name: 'HDRezka',
  rank: 110,
  flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
  scrapeShow: universalScraper,
  scrapeMovie: universalScraper,
});
