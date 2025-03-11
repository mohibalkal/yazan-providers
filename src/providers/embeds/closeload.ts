import { load } from 'cheerio';
import { unpack } from 'unpacker';

import { flags } from '@/entrypoint/utils/targets';
import { NotFoundError } from '@/utils/errors';

import { makeEmbed } from '../base';
import { Caption, getCaptionTypeFromUrl, labelToLanguageCode } from '../captions';

const referer = 'https://ridomovies.tv/';

export const closeLoadScraper = makeEmbed({
  id: 'closeload',
  name: 'CloseLoad',
  rank: 106,
  async scrape(ctx) {
    const baseUrl = new URL(ctx.url).origin;

    const iframeRes = await ctx.proxiedFetcher<string>(ctx.url, {
      headers: { referer },
    });
    const iframeRes$ = load(iframeRes);
    const captions: Caption[] = iframeRes$('track')
      .toArray()
      .map((el) => {
        const track = iframeRes$(el);
        const url = `${baseUrl}${track.attr('src')}`;
        const label = track.attr('label') ?? '';
        const language = labelToLanguageCode(label);
        const captionType = getCaptionTypeFromUrl(url);

        if (!language || !captionType) return null;
        return {
          id: url,
          language,
          hasCorsRestrictions: true,
          type: captionType,
          url,
        };
      })
      .filter((x): x is Caption => x !== null);

    const evalCode = iframeRes$('script')
      .toArray()
      .find((el) => {
        const script = iframeRes$(el);
        return (script.attr('type') === 'text/javascript' && script.html()?.includes('p,a,c,k,e,d')) ?? false;
      });
    
    const evalCodeHtml = evalCode ? iframeRes$(evalCode).html() : null;
    if (!evalCodeHtml) throw new Error("Couldn't find eval code");
    
    const decoded = unpack(evalCodeHtml);
    // eslint-disable-next-line no-useless-escape
    const base64UrlPattern = /"(aHR0c[0-9a-zA-Z\+\/\=]+)"/;
    const match = base64UrlPattern.exec(decoded);
    if (!match || !match[1]) {
      throw new NotFoundError('Unable to find source url');
    }
    const base64Url = match[1];
    const url = atob(base64Url);
    const proxiedUrl = `https://m3u8.wafflehacker.io/m3u8-proxy?url=${encodeURIComponent(url)}&headers=%7B%22referer%22%3A%20%22https%3A%2F%2Fcloseload.top%2F%22%2C%20%22origin%22%3A%20%22https%3A%2F%2Fcloseload.top%22%7D`;
    
    return {
      stream: [
        {
          id: 'primary',
          type: 'hls',
          playlist: proxiedUrl,
          captions,
          flags: [flags.CORS_ALLOWED],
        },
      ],
    };
  },
});
