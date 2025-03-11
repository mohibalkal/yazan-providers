import { CheerioAPI, Element, load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { Caption, labelToLanguageCode, removeDuplicatedLanguages } from '@/providers/captions';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

import { InfoResponse } from './types';
import { SourcererOutput, makeSourcerer } from '../../base';

const baseUrl = 'https://soaper.live';

const universalScraper = async (ctx: MovieScrapeContext | ShowScrapeContext): Promise<SourcererOutput> => {
  const searchResult = await ctx.proxiedFetcher('/search.html', {
    baseUrl,
    query: {
      keyword: ctx.media.title,
    },
  });
  const searchResult$ = load(searchResult);
  const matchingLinks = searchResult$('a')
    .toArray()
    .filter((el: Element) => searchResult$(el).text() === ctx.media.title);

  let showLink = matchingLinks.length > 0 ? searchResult$(matchingLinks[0]).attr('href') : undefined;
  if (!showLink) throw new NotFoundError('Content not found');

  if (ctx.media.type === 'show') {
    const seasonNumber = ctx.media.season.number;
    const episodeNumber = ctx.media.episode.number;
    const showPage = await ctx.proxiedFetcher(showLink, { baseUrl });
    const showPage$ = load(showPage);

    // Find all episode links
    const episodes = showPage$('a')
      .toArray()
      .filter((el: Element) => {
        const $el = showPage$(el);
        const text = $el.text();
        return text.startsWith(`${episodeNumber}.`);
      });

    if (episodes.length === 0) throw new NotFoundError('Episode not found');
    showLink = showPage$(episodes[0]).attr('href');
  }
  if (!showLink) throw new NotFoundError('Content not found');
  const contentPage = await ctx.proxiedFetcher(showLink, { baseUrl });
  const contentPage$ = load(contentPage);

  const pass = contentPage$('#hId').attr('value');

  if (!pass) throw new NotFoundError('Content not found');

  const formData = new URLSearchParams();
  formData.append('pass', pass);
  formData.append('e2', '0');
  formData.append('server', '0');

  const infoEndpoint = ctx.media.type === 'show' ? '/home/index/getEInfoAjax' : '/home/index/getMInfoAjax';
  const streamRes = await ctx.proxiedFetcher<string>(infoEndpoint, {
    baseUrl,
    method: 'POST',
    body: formData,
    headers: {
      referer: `${baseUrl}${showLink}`,
    },
  });

  const streamResJson: InfoResponse = JSON.parse(streamRes);
  const playlistUrl = `${baseUrl}${streamResJson.val}`;
  const backupPlaylistUrl = `${baseUrl}${streamResJson.val_bak}`;
  const backupPlayRes = await ctx.proxiedFetcher(backupPlaylistUrl, { headers: { referer: `${baseUrl}${showLink}` } });
  const playlistRes = await ctx.proxiedFetcher(playlistUrl, { headers: { referer: `${baseUrl}${showLink}` } });
  const base64Encoded = btoa(unescape(encodeURIComponent(playlistRes)));
  const backupBase64Encoded = btoa(unescape(encodeURIComponent(backupPlayRes)));
  const finalPlaylistUrl = `data:application/vnd.apple.mpegurl;base64,${base64Encoded}`;
  const finalBackupPlaylistUrl = `data:application/vnd.apple.mpegurl;base64,${backupBase64Encoded}`;

  const captions: Caption[] = [];
  if (Array.isArray(streamResJson.subs)) {
    // Check if streamResJson.subs is an array
    for (const sub of streamResJson.subs) {
      const proxyPrefix = `https://proxy.wafflehacker.io?destination=`;
      const fullSubUrl = `${proxyPrefix}${encodeURIComponent(baseUrl + sub.path)}`;

      let language: string | null = '';
      if (sub.name.includes('.srt')) {
        language = labelToLanguageCode(sub.name.split('.srt')[0]);
      } else if (sub.name.includes(':')) {
        language = sub.name.split(':')[0];
      } else {
        language = sub.name;
      }
      if (!language) continue;

      captions.push({
        id: fullSubUrl,
        url: fullSubUrl,
        type: 'srt',
        hasCorsRestrictions: false,
        language,
      });
    }
  }
  const noDupes = removeDuplicatedLanguages(captions);
  return {
    embeds: [],
    stream: [
      {
        id: 'primary',
        playlist: finalPlaylistUrl,
        type: 'hls',
        flags: [flags.CORS_ALLOWED],
        captions: noDupes,
      },
      ...(streamResJson.val_bak
        ? [
            {
              id: 'backup',
              playlist: finalBackupPlaylistUrl,
              type: 'hls' as const,
              flags: [flags.CORS_ALLOWED],
              captions: noDupes,
            },
          ]
        : []),
    ],
  };
};

export const soaperTvScraper = makeSourcerer({
  id: 'soapertv',
  name: 'SoaperTV',
  rank: 126,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: universalScraper,
  scrapeShow: universalScraper,
});
