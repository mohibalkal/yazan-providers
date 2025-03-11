import { CheerioAPI, Element, load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { makeSourcerer } from '@/providers/base';
import { ScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

import { primewireApiKey, primewireBase } from './common';
import { getLinks } from './decryption/blowfish';

async function search(ctx: ScrapeContext, imdbId: string) {
  const searchResult = await ctx.proxiedFetcher<{
    id: string;
  }>('/api/v1/show/', {
    baseUrl: primewireBase,
    query: {
      key: primewireApiKey,
      imdb_id: imdbId,
    },
  });

  return searchResult.id;
}

async function getStreams(title: string) {
  const $page = load(title);
  const userData = $page('#user-data').attr('v');
  if (!userData) throw new NotFoundError('No user data found');

  const links = getLinks(userData);
  const embeds = [];

  if (!links) throw new NotFoundError('No links found');

  for (const link in links) {
    if (link.includes(link)) {
      const $element = $page(`.propper-link[link_version='${link}']`);
      const sourceName = $element.find('.version-host').text().trim();

      let embedId;
      switch (sourceName) {
        case 'upstream.to':
          embedId = 'upstream';
          break;
        case 'streamwish.to':
          embedId = 'streamwish';
          break;
        case 'vtube.to':
          embedId = 'vtube';
          break;
        case 'vidmoly.me':
          embedId = 'vidmoly';
          break;
        default:
          embedId = null;
      }
      if (!embedId) continue;
      embeds.push({
        url: `${primewireBase}/links/go/${links[link]}`,
        embedId,
      });
    }
  }

  return embeds;
}

export const primewireScraper = makeSourcerer({
  id: 'primewire',
  name: 'Primewire',
  rank: 85,
  flags: [flags.CORS_ALLOWED],
  async scrapeMovie(ctx) {
    if (!ctx.media.imdbId) throw new Error('No imdbId provided');
    const searchResult = await search(ctx, ctx.media.imdbId);

    const title = await ctx.proxiedFetcher<string>(`movie/${searchResult}`, {
      baseUrl: primewireBase,
    });

    const embeds = await getStreams(title);

    return {
      embeds,
    };
  },
  async scrapeShow(ctx) {
    if (!ctx.media.imdbId) throw new Error('No imdbId provided');
    const searchResult = await search(ctx, ctx.media.imdbId);

    const season = await ctx.proxiedFetcher<string>(`tv/${searchResult}`, {
      baseUrl: primewireBase,
    });

    const $page = load(season);
    const episodeSelector = `.show_season[data-id='${ctx.media.season.number}'] > div > a`;
    const $episodes = $page(episodeSelector);

    const episodeUrl = $episodes
      .toArray()
      .map((element) => $page(element).attr('href'))
      .find((href) => href?.includes(`-episode-${ctx.media.episode.number}`));

    if (!episodeUrl) throw new NotFoundError('Episode not found');

    const title = await ctx.proxiedFetcher<string>(episodeUrl, {
      baseUrl: primewireBase,
    });

    const embeds = await getStreams(title);

    return {
      embeds,
    };
  },
});
