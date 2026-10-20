import data from 'emojibase-data/en/data.json';
import messages from 'emojibase-data/en/messages.json';

// Emoji data for the reaction picker, served from the app instead of a public CDN.
// Built once at build time; the picker requests `/emojibase/en/{data,messages}.json`.
export const dynamic = 'force-static';

const FILES: Record<string, unknown> = {
  'data.json': data,
  'messages.json': messages,
};

export function generateStaticParams() {
  return Object.keys(FILES).map((file) => ({ locale: 'en', file }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; file: string }> }
) {
  const { locale, file } = await params;
  const body = locale === 'en' ? FILES[file] : undefined;

  if (!body) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(body, {
    headers: { 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400' },
  });
}
