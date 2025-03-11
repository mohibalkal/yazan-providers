import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { Caption, getCaptionTypeFromUrl, labelToLanguageCode } from '@/providers/captions';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';
import { load } from 'cheerio';

interface Source {
  name: string;
  data: {
    stream: string;
    subtitle: Array<{ lang: string; file: string }>;
  };
}

interface ApiResponse {
  sources: Source[];
  url: string;
}

const vidSrcToBase = "https://vidsrc.to";
const referer = `${vidSrcToBase}/`;

function decryptSourceUrl(url: string): string {
  try {
    // Add decryption logic here if needed
    return url;
  } catch (error) {
    return url;
  }
}

const universalScraper = async (ctx: MovieScrapeContext | ShowScrapeContext): Promise<SourcererOutput> => {
  // Try the new API first
  try {
    const apiRes: ApiResponse = await ctx.fetcher<ApiResponse>(
      `https://vidsrcto-two.vercel.app/vidsrc/${ctx.media.tmdbId}`,
      {
        query: {
          ...(ctx.media.type === 'show' && {
            s: ctx.media.season.number.toString(),
            e: ctx.media.episode.number.toString(),
          }),
        },
      },
    );

    const streams: any[] = [];
    const embeds: any[] = [];
    
    // Try F2Cloud source first
    const f2CloudSource = apiRes.sources.find((source) => source.name === 'F2Cloud');
    if (f2CloudSource?.data.stream) {
      const proxiedStreamURL = `https://m3u8.wafflehacker.io/m3u8-proxy?url=${encodeURIComponent(f2CloudSource.data.stream)}`;
      const subtitles = Array.isArray(f2CloudSource.data.subtitle) ? f2CloudSource.data.subtitle : [];

      const captions: Caption[] =
        subtitles?.map((sub) => ({
          id: sub.file,
          url: sub.file,
          type: getCaptionTypeFromUrl(sub.file) || 'vtt',
          language: labelToLanguageCode(sub.lang) || 'und',
          hasCorsRestrictions: false,
        })) || [];

      streams.push({
        id: 'f2cloud',
        type: 'hls',
        playlist: proxiedStreamURL,
        captions,
        flags: [flags.CORS_ALLOWED],
      });
    }

    // If no F2Cloud, try fallback method
    if (streams.length === 0) {
      const mediaId = ctx.media.imdbId ?? ctx.media.tmdbId;
      const url = ctx.media.type === "movie" 
        ? `/embed/movie/${mediaId}` 
        : `/embed/tv/${mediaId}/${ctx.media.season.number}/${ctx.media.episode.number}`;

      const mainPage = await ctx.proxiedFetcher(url, {
        baseUrl: vidSrcToBase,
        headers: { referer }
      });

      const mainPage$ = load(mainPage);
      const dataId = mainPage$("a[data-id]").attr("data-id");
      
      if (dataId) {
        const sources = await ctx.proxiedFetcher(`/ajax/embed/episode/${dataId}/sources`, {
          baseUrl: vidSrcToBase,
          headers: { referer }
        });

        if (sources.status === 200) {
          const embedArr = [];
          
          for (const source of sources.result) {
            const sourceRes = await ctx.proxiedFetcher(`/ajax/embed/source/${source.id}`, {
              baseUrl: vidSrcToBase,
              headers: { referer }
            });
            
            const decryptedUrl = decryptSourceUrl(sourceRes.result.url);
            embedArr.push({ source: source.title, url: decryptedUrl });
          }

          // Add Vidplay embed
          const vidplayEmbed = embedArr.find(e => e.source === "Vidplay");
          if (vidplayEmbed) {
            embeds.push({
              embedId: "vidplay",
              url: new URL(vidplayEmbed.url).toString()
            });
          }

          // Add Filemoon embeds
          const filemoonEmbed = embedArr.find(e => e.source === "Filemoon");
          if (filemoonEmbed) {
            const fullUrl = new URL(filemoonEmbed.url);
            const urlWithSubtitles = embedArr.find(v => 
              v.source === "Vidplay" && v.url.includes("sub.info")
            )?.url;

            if (urlWithSubtitles) {
              const subtitleUrl = new URL(urlWithSubtitles).searchParams.get("sub.info");
              if (subtitleUrl) fullUrl.searchParams.set("sub.info", subtitleUrl);
            }

            embeds.push(
              {
                embedId: "filemoon",
                url: fullUrl.toString()
              },
              {
                embedId: "filemoon-mp4",
                url: fullUrl.toString()
              }
            );
          }
        }
      }
    }

    if (streams.length === 0 && embeds.length === 0) {
      throw new NotFoundError('No streams or embeds found');
    }

    return {
      stream: streams,
      embeds
    };

  } catch (error) {
    throw new NotFoundError('Failed to fetch content');
  }
};

export const vidSrcToScraper = makeSourcerer({
  id: 'vidsrcto',
  name: 'VidSrcTo',
  disabled: false, // Enabling the source
  scrapeMovie: universalScraper,
  scrapeShow: universalScraper,
  flags: [flags.CORS_ALLOWED],
  rank: 260, // Increased rank to match the other implementation
});
