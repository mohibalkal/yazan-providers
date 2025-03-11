declare module 'cheerio' {
  export interface CheerioAPI {
    (selector: string | Element): Cheerio;
    load(html: string): CheerioAPI;
  }

  export interface Element {
    type: string;
    data?: string;
    children: Element[];
    firstChild?: Element;
  }

  export interface Cheerio {
    find(selector: string): Cheerio;
    text(): string;
    html(): string | null;
    attr(name: string): string | undefined;
    contents(): Cheerio;
    first(): Cheerio;
    toArray(): Element[];
    get(): Element[];
    each(func: (index: number, element: Element) => void | boolean): Cheerio;
    eq(i: number): Cheerio;
  }

  export function load(html: string): CheerioAPI;
} 