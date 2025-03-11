import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://uira.live';

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const searchSlug = ctx.media.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const searchUrl = ctx.media.type === 'movie' ? `/movie/${searchSlug}` : `/show/${searchSlug}`;

  const page = await ctx.proxiedFetcher(searchUrl, {
    baseUrl,
    headers: {
      Referer: baseUrl,
    },
  });

  const $ = load(page);
  const results = $('.movie-item')
    .toArray()
    .map((el) => {
      const $el = $(el);
      const title = $el.find('.movie-title').text().trim();
      const year = parseInt($el.find('.movie-year').text().match(/\d{4}/)?.[0] || '', 10);
      const id = $el.attr('data-id');
      return { title, year, id };
    })
    .filter((item: { id?: string; year?: number }) => {
      if (!item.id) return false;
      if (ctx.media.releaseYear && item.year && ctx.media.releaseYear !== item.year) return false;
      return true;
    });

  if (results.length === 0) {
    throw new NotFoundError('Media not found');
  }

  ctx.progress(30);

  const mediaUrl = ctx.media.type === 'movie'
    ? `/ajax/movie/${results[0].id}/servers`
    : `/ajax/show/${results[0].id}/season/${ctx.media.season.number}/episode/${ctx.media.episode.number}/servers`;

  const serversData = await ctx.proxiedFetcher<{ servers: Array<{ name: string; url: string }> }>(mediaUrl, {
    baseUrl,
    headers: {
      Referer: baseUrl,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!serversData?.servers?.length) {
    throw new NotFoundError('No servers found');
  }

  const embeds: SourcererEmbed[] = serversData.servers.map((server) => ({
    embedId: server.name.toLowerCase(),
    url: server.url,
  }));

  return {
    embeds,
  };
}

export const uiraliveScraper = makeSourcerer({
  id: 'uiralive',
  name: 'Uira.Live',
  rank: 181,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
