import { EmbedOutput, makeEmbed } from '@/providers/base';
import { baseUrl } from '@/providers/sources/whvx';
import { NotFoundError } from '@/utils/errors';

const providers = [
  {
    id: 'nova',
    rank: 720,
  },
  {
    id: 'astra',
    rank: 700,
  },
  {
    id: 'orion',
    rank: 710,
  },
];

export const headers = {
  Origin: 'https://api.whvx.net',
  Referer: 'https://api.whvx.net',
};

function embed(provider: { id: string; rank: number }) {
  return makeEmbed({
    id: provider.id,
    name: provider.id.charAt(0).toUpperCase() + provider.id.slice(1),
    rank: provider.rank,
    disabled: false,
    async scrape(ctx) {
      let progress = 50;
      const interval = setInterval(() => {
        if (progress < 100) {
          progress += 1;
          ctx.progress(progress);
        }
      }, 100);

      try {
        // eslint-disable-next-line dot-notation
        const token = (window as any)['vbtk'] as string;

        // Construct the base URL with the query
        let searchUrl = `${baseUrl}/search?query=${encodeURIComponent(ctx.url)}&provider=${provider.id}`;

        // Append the token to the URL if it exists
        if (token) {
          searchUrl += `&token=${encodeURIComponent(token)}`;
        }

        // Make the API request
        const search = await ctx.fetcher.full(searchUrl, { headers });

        if (search.statusCode === 429) {
          throw new Error('Rate limited');
        } else if (search.statusCode !== 200) {
          throw new NotFoundError('Failed to search');
        }

        const result = await ctx.fetcher(
          `${baseUrl}/source?resourceId=${encodeURIComponent(search.body.url)}&provider=${provider.id}`,
          { headers },
        );

        clearInterval(interval);
        ctx.progress(100);

        return result as EmbedOutput;
      } catch (error) {
        clearInterval(interval);
        ctx.progress(100);
        throw new NotFoundError('Failed to search');
      }
    },
  });
}

export const [novaScraper, astraScraper, orionScraper] = providers.map(embed);
