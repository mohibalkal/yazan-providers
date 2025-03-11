import { getCaptionTypeFromUrl, labelToLanguageCode } from '@/providers/captions';
import { FileBasedStream } from '@/providers/streams';
import { NotFoundError } from '@/utils/errors';
import { getValidQualityFromString } from '@/utils/quality';

function generateRandomFavs(): string {
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const generateSegment = (length: number) => Array.from({ length }, randomHex).join('');

  return `${generateSegment(8)}-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(12)}`;
}

function decodeUrl(encodedUrl: string): string {
  try {
    // محاولة فك تشفير Base64
    const decoded = atob(encodedUrl);
    if (decoded.startsWith('http')) {
      return decoded;
    }
  } catch {}

  try {
    // محاولة فك تشفير #h
    if (encodedUrl.includes('#h')) {
      return encodedUrl.split('#h')[0];
    }
  } catch {}

  // محاولة فك تشفير التشفير المخصص
  try {
    const customEncoded = encodedUrl.replace(/[a-zA-Z]/g, (char) => {
      const shift = char.toLowerCase() === char ? 13 : -13;
      const base = char.toLowerCase() === char ? 97 : 65;
      return String.fromCharCode(((char.charCodeAt(0) - base + shift + 26) % 26) + base);
    });
    if (customEncoded.startsWith('http')) {
      return customEncoded;
    }
  } catch {}

  return encodedUrl;
}

function parseVideoLinks(inputString?: string): FileBasedStream['qualities'] {
  if (!inputString) throw new NotFoundError('No video links found');
  
  const linksArray = inputString.split(',');
  const result: FileBasedStream['qualities'] = {};
  
  linksArray.forEach((link) => {
    // تحسين التعبير النمطي ليشمل المزيد من التنسيقات
    const match = link.match(/\[([^\]]+)](https?:\/\/[^\s,]+\.(mp4|m3u8|mkv))/);
    if (!match) return;

    const [, qualityText, videoUrl, format] = match;
    const decodedUrl = decodeUrl(videoUrl);
    
    // استخراج الجودة من النص
    const qualityMatch = qualityText.match(/(\d+)p/);
    const quality = qualityMatch ? qualityMatch[1] + 'p' : 'auto';
    const validQuality = getValidQualityFromString(quality);
    
    // تحديد نوع الملف
    const type = format === 'm3u8' ? 'mp4' : 'mp4';
    
    result[validQuality] = {
      type,
      url: decodedUrl
    };
  });
  
  return result;
}

function parseSubtitleLinks(inputString?: string | boolean): FileBasedStream['captions'] {
  if (!inputString || typeof inputString === 'boolean') return [];
  
  const linksArray = inputString.split(',');
  const captions: FileBasedStream['captions'] = [];
  
  linksArray.forEach((link) => {
    const match = link.match(/\[([^\]]+)\](https?:\/\/\S+?)(?=,\[|$)/);
    if (!match) return;

    const [, label, subtitleUrl] = match;
    const decodedUrl = decodeUrl(subtitleUrl);
    
    const type = getCaptionTypeFromUrl(decodedUrl);
    const language = labelToLanguageCode(label.trim());
    
    if (!type || !language) return;
    
    captions.push({
      id: decodedUrl,
      language,
      hasCorsRestrictions: false,
      type,
      url: decodedUrl
    });
  });
  
  return captions;
}

function extractTitleAndYear(input: string) {
  // تحسين التعبير النمطي للعنوان والسنة
  const patterns = [
    /^(.*?),.*?(\d{4})/, // النمط الأصلي
    /^(.*?)\s*\((\d{4})\)/, // نمط بديل
    /^(.*?)\s+(\d{4})$/ // نمط بسيط
  ];

  for (const regex of patterns) {
    const match = input.match(regex);
    if (match) {
      const [, title, year] = match;
      return {
        title: title.trim(),
        year: parseInt(year, 10)
      };
    }
  }

  // إذا لم يتم العثور على سنة، نعيد العنوان فقط
  return {
    title: input.trim(),
    year: null
  };
}

export { extractTitleAndYear, parseSubtitleLinks, parseVideoLinks, generateRandomFavs, decodeUrl };
