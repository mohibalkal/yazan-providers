import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

const baseUrl = 'https://autoembed.to';

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  const searchUrl = ctx.media.type === 'movie'
    ? `/movie/${ctx.media.tmdbId}`
    : `/tv/${ctx.media.tmdbId}-${ctx.media.season.number}-${ctx.media.episode.number}`;

  const page = await ctx.proxiedFetcher(searchUrl, {
    baseUrl,
    headers: {
      Referer: baseUrl,
    },
  });

  if (!page) throw new NotFoundError('Page not found');
  ctx.progress(30);

  const $ = load(page);
  const servers = $('.server-item')
    .toArray()
    .map((el) => {
      const $el = $(el);
      const embedId = $el.attr('data-id');
      const url = $el.attr('data-link');
      if (!embedId || !url) return null;
      return {
        embedId,
        url,
      };
    })
    .filter((v): v is SourcererEmbed => v !== null);

  if (servers.length === 0) throw new NotFoundError('No servers found');

  return {
    embeds: servers,
  };
}

export const autoembedScraper = makeSourcerer({
  id: 'autoembed',
  name: 'AutoEmbed',
  rank: 260,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
