import { flags } from '@/entrypoint/utils/targets';
import { SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  try {
    ctx.progress(25);
    
    const urlEncodedTitle = encodeURIComponent(ctx.media.title);
    const urlEncodedReleaseYear = encodeURIComponent(ctx.media.releaseYear);
    
    let url = `https://ee3.wafflehacker.io/search?title=${urlEncodedTitle}&releaseYear=${urlEncodedReleaseYear}`;
    
    // إضافة معلومات المسلسل إذا كان المحتوى مسلسلاً
    if (ctx.media.type === 'show') {
      url += `&type=show&season=${ctx.media.season.number}&episode=${ctx.media.episode.number}`;
    } else {
      url += '&type=movie';
    }
    
    ctx.progress(50);
    
    const response = await ctx.fetcher(url);
    
    ctx.progress(75);
    
    if (response.statusCode === 404) {
      throw new NotFoundError(`${ctx.media.type === 'show' ? 'Episode' : 'Movie'} Not Found`);
    }
    
    if (!response) {
      throw new NotFoundError(`No data found for this ${ctx.media.type}`);
    }
    
    ctx.progress(100);
    return response as SourcererOutput;
    
  } catch (error) {
    ctx.progress(100);
    if (error instanceof NotFoundError) throw error;
    throw new NotFoundError(`Failed to fetch ${ctx.media.type}`);
  }
}

export const ee3Scraper = makeSourcerer({
  id: 'ee3',
  name: 'EE3',
  rank: 155,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper, // إضافة دعم للمسلسلات
});
