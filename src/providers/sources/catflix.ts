import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { compareMedia } from '@/utils/compare';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';
import { makeCookieHeader, parseSetCookie } from '@/utils/cookie';

const baseUrl = 'https://catflix.su';

// تحسين معالجة العناوين
function normalizeTitle(title: string): string {
  let titleTrimmed = title.trim().toLowerCase();
  
  // إزالة الكلمات الزائدة
  if (titleTrimmed !== "the movie" && titleTrimmed.endsWith("the movie")) {
    titleTrimmed = titleTrimmed.replace("the movie", "");
  }
  if (titleTrimmed !== "the series" && titleTrimmed.endsWith("the series")) {
    titleTrimmed = titleTrimmed.replace("the series", "");
  }
  
  // تنظيف العنوان من الرموز الخاصة
  return titleTrimmed
    .replace(/['":]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_");
}

// استخراج الروابط من السكريبت
function extractEmbedFromScript($: CheerioAPI): string | null {
  let embedUrl: string | null = null;
  
  $("script").each((_, script) => {
    const content = $(script).html();
    if (content && content.includes("main_origin =")) {
      const match = content.match(/main_origin = "(.*?)";/);
      if (match) {
        try {
          embedUrl = atob(match[1]);
          return false; // break the loop
        } catch {
          // continue searching
        }
      }
    }
  });
  
  return embedUrl;
}

// البحث باستخدام معرف TMDB
async function searchByTMDB(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput | null> {
  try {
    const mediaTitle = ctx.media.title
      .replace(/ /g, "-")
      .replace(/[():]/g, "")
      .toLowerCase();
    
    const watchPageUrl = ctx.media.type === "movie"
      ? `${baseUrl}/movie/${mediaTitle}-${ctx.media.tmdbId}`
      : `${baseUrl}/episode/${mediaTitle}-season-${ctx.media.season.number}-episode-${ctx.media.episode.number}/eid-${ctx.media.episode.tmdbId}`;

    const watchPage = await ctx.proxiedFetcher(watchPageUrl);
    const $ = load(watchPage);
    
    const embedUrl = extractEmbedFromScript($);
    if (!embedUrl) return null;

    return {
      embeds: [
        {
          embedId: "turbovid",
          url: embedUrl
        }
      ]
    };
  } catch {
    return null;
  }
}

// البحث باستخدام العنوان
async function searchByTitle(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput | null> {
  try {
    const searchPage = await ctx.proxiedFetcher('/', {
      baseUrl,
      query: {
        s: ctx.media.title,
      },
    });

    const $search = load(searchPage);
    const searchResults: { title: string; year?: number; url: string }[] = [];

    $search('li').each((_, element) => {
      const title = $search(element).find('h2').first().text().trim();
      const year = Number($search(element).find('.text-xs > span').eq(1).text().trim()) || undefined;
      const url = $search(element).find('a').attr('href');

      if (!title || !url) return;
      searchResults.push({ title, year, url });
    });

    const match = searchResults.find((x) => x && compareMedia(ctx.media, x.title, x.year));
    if (!match?.url) return null;

    let watchPageUrl = match.url;
    if (ctx.media.type === 'show') {
      const urlMatch = watchPageUrl.match(/\/series\/([^/]+)\/?/);
      if (!urlMatch) return null;
      
      watchPageUrl = watchPageUrl.replace(
        `/series/${urlMatch[1]}`,
        `/episode/${urlMatch[1]}-${ctx.media.season.number}x${ctx.media.episode.number}`,
      );
    }

    const watchPage = load(await ctx.proxiedFetcher(watchPageUrl));
    const embedUrl = extractEmbedFromScript(watchPage) || watchPage('iframe').first().attr('src');
    
    if (!embedUrl) return null;

    return {
      embeds: [
        {
          embedId: 'turbovid',
          url: embedUrl,
        },
      ],
    };
  } catch {
    return null;
  }
}

// الدالة الرئيسية للبحث
async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  ctx.progress(20);
  
  // محاولة البحث باستخدام معرف TMDB أولاً
  const tmdbResult = await searchByTMDB(ctx);
  if (tmdbResult) {
    ctx.progress(100);
    return tmdbResult;
  }

  ctx.progress(50);
  
  // محاولة البحث باستخدام العنوان إذا فشل البحث الأول
  const titleResult = await searchByTitle(ctx);
  if (titleResult) {
    ctx.progress(100);
    return titleResult;
  }

  throw new NotFoundError('No watchable item found');
}

export const catflixScraper = makeSourcerer({
  id: 'catflix',
  name: 'Catflix',
  rank: 160,
  flags: [],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
