import { Fragment, type ReactNode } from 'react';

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

// WhatsApp's markup: *bold*, _italic_, ~strikethrough~, `inline code` and ```monospace```.
const FORMAT_PATTERN = /```([\s\S]+?)```|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

function format(text: string, keyPrefix = 'f'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(FORMAT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(<Fragment key={`${keyPrefix}${index}t`}>{text.slice(lastIndex, index)}</Fragment>);

    const [, block, code, bold, italic, strike] = match;
    const key = `${keyPrefix}${index}`;
    if (block !== undefined) {
      nodes.push(<code key={key} className="block whitespace-pre-wrap rounded bg-black/5 px-1.5 py-1 font-mono text-[0.85em] dark:bg-white/10">{block}</code>);
    } else if (code !== undefined) {
      nodes.push(<code key={key} className="rounded bg-black/5 px-1 font-mono text-[0.85em] dark:bg-white/10">{code}</code>);
    } else if (bold !== undefined) {
      nodes.push(<strong key={key} className="font-semibold">{format(bold, `${key}b`)}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{format(italic, `${key}i`)}</em>);
    } else if (strike !== undefined) {
      nodes.push(<s key={key}>{format(strike, `${key}s`)}</s>);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(<Fragment key={`${keyPrefix}end`}>{text.slice(lastIndex)}</Fragment>);
  return nodes;
}

/** Message text with WhatsApp formatting and clickable links, rendered as React nodes (never raw HTML). */
export function FormattedText({ text }: { text: string }) {
  // Links first, so underscores or asterisks inside a URL aren't read as formatting.
  return (
    <>
      {text.split(URL_PATTERN).map((part, index) => (
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-primary underline underline-offset-2 hover:opacity-80"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{format(part, `p${index}`)}</Fragment>
        )
      ))}
    </>
  );
}
