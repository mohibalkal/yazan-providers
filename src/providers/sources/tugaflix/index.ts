import { type CheerioAPI, load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, makeSourcerer } from '@/providers/base';
import { compareMedia } from '@/utils/compare';
import { NotFoundError, TimeoutError } from '@/utils/errors';
import { sleep } from '@/utils/promise';

import { baseUrl, parseSearch } from './common';

// قائمة النطاقات البديلة مع الأولوية
const domains = [
  'https://tugaflix.best',
  'https://tugaflix.com',
  'https://tugaflix.net',
  'https://tugaflix.to',
  'https://tugaflix.cc',
];

// تكوين المشغلات المدعومة مع معلومات إضافية
const supportedPlayers = {
  streamtape: {
    id: 'streamtape',
    pattern: /streamtape\.com/,
    priority: 1,
    quality: 'HD',
  },
  dood: {
    id: 'dood',
    pattern: /dood\.(watch|to|so|pm|wf|re|yt|ws|sh|la)/,
    priority: 2,
    quality: 'HD',
  },
  mixdrop: {
    id: 'mixdrop',
    pattern: /mixdrop\.(co|to|sx|bz|ch)/,
    priority: 3,
    quality: 'HD',
  },
  upstream: {
    id: 'upstream',
    pattern: /upstream\.to/,
    priority: 4,
    quality: 'HD',
  },
  vidlox: {
    id: 'vidlox',
    pattern: /vidlox\.(me|tv)/,
    priority: 5,
    quality: 'HD',
  },
};

// وظيفة محاولة الوصول للنطاقات مع إعادة المحاولة
async function tryDomains<T>(action: (baseUrl: string) => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;

  for (const domain of domains) {
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        return await action(domain);
      } catch (error) {
        lastError = error as Error;
        if (error instanceof TimeoutError) {
          await sleep(1000 * (retry + 1)); // انتظار متزايد بين المحاولات
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new NotFoundError('All domains failed');
}

// وظيفة تحسين عنوان البحث
function optimizeSearchTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // إزالة الأحرف الخاصة
    .replace(/\s+/g, ' ') // توحيد المسافات
    .trim();
}

// وظيفة استخراج الروابط المضمنة مع التحقق من الجودة
async function extractEmbeds(ctx: any, $: CheerioAPI, selector: string): Promise<SourcererEmbed[]> {
  const embeds: SourcererEmbed[] = [];
  const processedUrls = new Set<string>(); // لتجنب تكرار الروابط

  const selectors = [selector, 'iframe[src]', 'source[src]', 'a[href*="player"]', 'a[href*="embed"]', '.download-btn'];

  for (const currentSelector of selectors) {
    const elements = $(currentSelector).toArray();
    for (const element of elements) {
      const embedUrl = $(element).attr('href') || $(element).attr('src');
      if (!embedUrl || processedUrls.has(embedUrl)) continue;

      processedUrls.add(embedUrl);

      try {
        const fullUrl = embedUrl.startsWith('https://') ? embedUrl : `https://${embedUrl}`;
        const embedPage = await ctx.proxiedFetcher.full(fullUrl);
        const embedHtml = load(embedPage.body);

        // البحث عن روابط في أماكن مختلفة
        const potentialLinks = [
          embedHtml('a:contains("Download")').attr('href'),
          embedHtml('a:contains("Filme")').attr('href'),
          embedHtml('a:contains("Episodio")').attr('href'),
          embedHtml('a[href*="download"]').attr('href'),
          embedHtml('source[src]').attr('src'),
          embedHtml('iframe[src]').attr('src'),
          embedHtml('video[src]').attr('src'),
        ].filter(Boolean);

        for (const url of potentialLinks) {
          if (!url || processedUrls.has(url)) continue;
          processedUrls.add(url);

          // التحقق من المشغل المناسب وإضافته مع معلومات الجودة
          for (const [, player] of Object.entries(supportedPlayers)) {
            if (player.pattern.test(url)) {
              embeds.push({
                embedId: player.id,
                url,
              });
              break;
            }
          }
        }
      } catch (error) {
        console.error('Error extracting embed:', error);
        continue;
      }
    }
  }

  // ترتيب الروابط حسب الأولوية
  return embeds.sort((a, b) => {
    const priorityA = supportedPlayers[a.embedId as keyof typeof supportedPlayers]?.priority || 999;
    const priorityB = supportedPlayers[b.embedId as keyof typeof supportedPlayers]?.priority || 999;
    return priorityA - priorityB;
  });
}

export const tugaflixScraper = makeSourcerer({
  id: 'tugaflix',
  name: 'Tugaflix',
  rank: 75,
  flags: [flags.IP_LOCKED],

  scrapeMovie: async (ctx) => {
    ctx.progress(10);

    const searchResults = await tryDomains(async (currentBaseUrl) => {
      const optimizedTitle = optimizeSearchTitle(ctx.media.title);
      return parseSearch(
        await ctx.proxiedFetcher<string>('/filmes/', {
          baseUrl: currentBaseUrl,
          query: { s: optimizedTitle },
        }),
      );
    });

    if (searchResults.length === 0) {
      throw new NotFoundError('No watchable item found');
    }

    ctx.progress(30);

    const url = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))?.url;
    if (!url) {
      throw new NotFoundError('No watchable item found');
    }

    ctx.progress(50);

    const videoPage = await ctx.proxiedFetcher<string>(url, {
      method: 'POST',
      body: new URLSearchParams({ play: '' }),
    });

    const $ = load(videoPage);

    ctx.progress(70);

    const embeds = await extractEmbeds(ctx, $, '.play a, .watch-btn, .stream-link');

    ctx.progress(90);

    if (embeds.length === 0) {
      throw new NotFoundError('No playable sources found');
    }

    return { embeds };
  },

  scrapeShow: async (ctx) => {
    ctx.progress(10);

    const searchResults = await tryDomains(async (currentBaseUrl) => {
      const optimizedTitle = optimizeSearchTitle(ctx.media.title);
      return parseSearch(
        await ctx.proxiedFetcher<string>('/series/', {
          baseUrl: currentBaseUrl,
          query: { s: optimizedTitle },
        }),
      );
    });

    if (searchResults.length === 0) {
      throw new NotFoundError('No watchable item found');
    }

    ctx.progress(30);

    const url = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year))?.url;
    if (!url) {
      throw new NotFoundError('No watchable item found');
    }

    ctx.progress(50);

    // تنسيق رقم الموسم والحلقة بشكل أفضل
    const seasonNum = ctx.media.season.number.toString().padStart(2, '0');
    const episodeNum = ctx.media.episode.number.toString().padStart(2, '0');

    const videoPage = await ctx.proxiedFetcher(url, {
      method: 'POST',
      body: new URLSearchParams({ [`S${seasonNum}E${episodeNum}`]: '' }),
    });

    const $ = load(videoPage);

    ctx.progress(70);

    const embeds = await extractEmbeds(ctx, $, 'iframe[name="player"], .play a, .episode-btn');

    ctx.progress(90);

    if (embeds.length === 0) {
      throw new NotFoundError('No playable sources found');
    }

    return { embeds };
  },
});
