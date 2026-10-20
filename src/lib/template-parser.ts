import type {
  HeaderMediaFormat,
  ParameterFormat,
  Template,
  TemplateButton,
  TemplateComponent,
  TemplateParameter,
  TemplateParameterInfo,
  TemplateSendButton,
  TemplateSendHeader,
  TemplateSendRequest,
  TemplateTextParameter,
} from '@/types/whatsapp';

/**
 * Cloud API limits for template messages.
 * https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/components
 */
export const TEMPLATE_LIMITS = {
  headerText: 60,
  body: 1024,
  footer: 60,
  url: 2000,
  couponCode: 20,
  otp: 15,
  locationText: 1000,
} as const;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const MEDIA_HEADER_FORMATS: HeaderMediaFormat[] = ['IMAGE', 'VIDEO', 'DOCUMENT'];
const UNSUPPORTED_COMPONENTS: Record<string, string> = {
  CAROUSEL: 'carousel cards',
  LIMITED_TIME_OFFER: 'a limited-time offer',
};
const UNSUPPORTED_BUTTONS: Record<string, string> = {
  CATALOG: 'a catalog button',
  MPM: 'a multi-product button',
  SPM: 'a single-product button',
  ORDER_DETAILS: 'an order details button',
};

/** Placeholder names in the order they first appear (`1`, `2` or `first_name`). */
export function extractPlaceholders(text?: string): string[] {
  if (!text) return [];
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

function findComponent(template: Template, type: string): TemplateComponent | undefined {
  return template.components?.find((component) => component.type?.toUpperCase() === type);
}

export function getTemplateParts(template: Template) {
  return {
    header: findComponent(template, 'HEADER'),
    body: findComponent(template, 'BODY'),
    footer: findComponent(template, 'FOOTER'),
    buttons: findComponent(template, 'BUTTONS')?.buttons ?? [],
  };
}

/**
 * NAMED templates use `{{first_name}}`, POSITIONAL ones `{{1}}`. The Graph API
 * returns `parameter_format` for templates that set it; otherwise infer it.
 */
export function detectParameterFormat(template: Template): ParameterFormat {
  const declared = (template.parameterFormat ?? (template as { parameter_format?: string }).parameter_format)?.toUpperCase();
  if (declared === 'NAMED' || declared === 'POSITIONAL') return declared;

  const { header, body } = getTemplateParts(template);
  if (header?.example?.headerTextNamedParams?.length || body?.example?.bodyTextNamedParams?.length) {
    return 'NAMED';
  }

  const placeholders = [...extractPlaceholders(header?.text), ...extractPlaceholders(body?.text)];
  return placeholders.some((name) => !/^\d+$/.test(name)) ? 'NAMED' : 'POSITIONAL';
}

function exampleValue(example: TemplateButton['example']): string | undefined {
  if (typeof example === 'string') return example || undefined;
  return example?.[0] || undefined;
}

function isOtpButton(button: TemplateButton): boolean {
  const type = button.type?.toUpperCase();
  return type === 'OTP' || (type === 'URL' && /otp/i.test(button.url ?? ''));
}

function textParameters(
  component: TemplateComponent | undefined,
  scope: 'HEADER' | 'BODY',
  format: ParameterFormat,
): TemplateTextParameter[] {
  if (!component) return [];
  const example = component.example;
  const namedExamples = scope === 'HEADER' ? example?.headerTextNamedParams : example?.bodyTextNamedParams;
  const positionalExamples = scope === 'HEADER' ? example?.headerText : example?.bodyText?.[0];

  let names = extractPlaceholders(component.text);
  if (names.length === 0) {
    // No text to read placeholders from: fall back to the examples.
    names = format === 'NAMED'
      ? (namedExamples ?? []).map((param) => param.paramName)
      : (positionalExamples ?? []).map((_, index) => String(index + 1));
  }
  if (format === 'POSITIONAL') {
    names = names.filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(a) - Number(b));
  }
  // Headers take at most one parameter.
  if (scope === 'HEADER') names = names.slice(0, 1);

  const prefix = scope === 'HEADER' ? 'Header' : 'Body';
  return names.map((name) => ({
    key: `${scope.toLowerCase()}:${name}`,
    kind: 'text',
    component: scope,
    name,
    label: `${prefix} {{${name}}}`,
    example: format === 'NAMED'
      ? namedExamples?.find((param) => param.paramName === name)?.example
      : positionalExamples?.[Number(name) - 1],
  }));
}

/** Everything the template needs filled in at send time. */
export function getTemplateParameters(template: Template): TemplateParameterInfo {
  const format = detectParameterFormat(template);
  const parameters: TemplateParameter[] = [];
  const { header, body, buttons } = getTemplateParts(template);
  let unsupported: string | undefined;

  for (const component of template.components ?? []) {
    const reason = UNSUPPORTED_COMPONENTS[component.type?.toUpperCase()];
    if (reason) unsupported = `This template uses ${reason}, which the inbox can't fill in yet.`;
  }

  const headerFormat = header?.format?.toUpperCase();
  if (header) {
    if (!headerFormat || headerFormat === 'TEXT') {
      parameters.push(...textParameters(header, 'HEADER', format));
    } else if ((MEDIA_HEADER_FORMATS as string[]).includes(headerFormat)) {
      const mediaFormat = headerFormat as HeaderMediaFormat;
      parameters.push({
        key: 'header:media',
        kind: 'media',
        component: 'HEADER',
        format: mediaFormat,
        label: `Header ${mediaFormat.toLowerCase()}`,
      });
    } else if (headerFormat === 'LOCATION') {
      parameters.push({ key: 'header:location', kind: 'location', component: 'HEADER', label: 'Header location' });
    } else {
      unsupported ??= `This template has a ${headerFormat.toLowerCase()} header, which the inbox can't fill in yet.`;
    }
  }

  const otpButtonIndex = template.category?.toUpperCase() === 'AUTHENTICATION'
    ? buttons.findIndex(isOtpButton)
    : -1;

  if (template.category?.toUpperCase() === 'AUTHENTICATION') {
    // The code fills the body's {{1}} and, when present, the OTP button.
    parameters.push({
      key: 'otp',
      kind: 'otp',
      component: 'BODY',
      label: 'Verification code',
      example: body?.example?.bodyText?.[0]?.[0],
      ...(otpButtonIndex >= 0 && { buttonIndex: otpButtonIndex }),
    });
  } else {
    parameters.push(...textParameters(body, 'BODY', format));
  }

  buttons.forEach((button, index) => {
    if (index === otpButtonIndex) return;
    const type = button.type?.toUpperCase();
    const buttonText = button.text || `Button ${index + 1}`;

    if (type === 'URL' && button.url && extractPlaceholders(button.url).length > 0) {
      const prefix = button.url.split('{{')[0];
      const fullExample = exampleValue(button.example);
      parameters.push({
        key: `button:${index}`,
        kind: 'url',
        component: 'BUTTON',
        buttonIndex: index,
        buttonText,
        url: button.url,
        label: `“${buttonText}” link`,
        example: fullExample?.startsWith(prefix) ? fullExample.slice(prefix.length) || undefined : fullExample,
      });
      return;
    }

    if (type === 'COPY_CODE') {
      parameters.push({
        key: `button:${index}`,
        kind: 'coupon_code',
        component: 'BUTTON',
        buttonIndex: index,
        buttonText,
        label: 'Coupon code',
        example: exampleValue(button.example),
      });
      return;
    }

    const reason = UNSUPPORTED_BUTTONS[type];
    if (reason) unsupported ??= `This template has ${reason}, which the inbox can't fill in yet.`;
  });

  return { format, parameters, ...(unsupported && { unsupported }) };
}

export function templateHasParameters(template: Template): boolean {
  return getTemplateParameters(template).parameters.length > 0;
}

/**
 * Meta rejects text parameters with new lines, tabs or more than four
 * consecutive spaces (error 132018), so normalise them before sending.
 */
export function sanitizeTextParameter(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, ' ').trim();
}

export function hasDisallowedWhitespace(value: string): boolean {
  return /[\r\n\t]| {5,}/.test(value);
}

export function encodeUrlSuffix(value: string): string {
  return encodeURIComponent(value.trim());
}

/** The URL a dynamic URL button opens once the suffix is filled in. */
export function resolveButtonUrl(url: string, suffix: string): string {
  return url.replace(PLACEHOLDER_PATTERN, encodeUrlSuffix(suffix));
}

// ---- Form state, preview and validation ----

export type TemplateMediaValue = {
  source: 'upload' | 'link';
  mediaId?: string;
  fileName?: string;
  link: string;
};

export type TemplateLocationValue = {
  latitude: string;
  longitude: string;
  name: string;
  address: string;
};

export type TemplateFormValues = {
  /** Text, URL suffix, coupon and OTP values keyed by parameter key. */
  text: Record<string, string>;
  media: TemplateMediaValue;
  location: TemplateLocationValue;
};

export const EMPTY_TEMPLATE_FORM: TemplateFormValues = {
  text: {},
  media: { source: 'upload', link: '' },
  location: { latitude: '', longitude: '', name: '', address: '' },
};

export type TextSegment = { text: string; placeholder?: string; filled?: boolean };

export type TemplatePreview = {
  header?:
    | { kind: 'text'; segments: TextSegment[]; length: number }
    | { kind: 'media'; format: HeaderMediaFormat; fileName?: string }
    | { kind: 'location'; name?: string; address?: string };
  body?: { segments: TextSegment[]; length: number };
  footer?: { text: string; length: number };
  buttons: Array<{ type: string; text: string; url?: string }>;
};

export type TemplateFormEvaluation = {
  preview: TemplatePreview;
  /** Problems with values that were entered, keyed by parameter key (or `location.latitude` etc). */
  errors: Record<string, string>;
  /** Whole-message limits (header/body/footer length). */
  limitIssues: string[];
  /** Keys of required parameters that are still empty. */
  missing: string[];
  canSend: boolean;
};

function renderSegments(text: string, valueFor: (name: string) => string | undefined): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index) });
    const value = valueFor(match[1]);
    segments.push(value ? { text: value, placeholder: match[1], filled: true } : { text: match[0], placeholder: match[1], filled: false });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
  return segments;
}

const segmentsLength = (segments: TextSegment[]) => segments.reduce((total, segment) => total + segment.text.length, 0);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseCoordinate(value: string, limit: number): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : Number.NaN;
}

export function evaluateTemplateForm(
  template: Template,
  info: TemplateParameterInfo,
  values: TemplateFormValues,
): TemplateFormEvaluation {
  const parts = getTemplateParts(template);
  const errors: Record<string, string> = {};
  const limitIssues: string[] = [];
  const missing: string[] = [];
  const textValue = (key: string) => sanitizeTextParameter(values.text[key] ?? '');
  const otp = info.parameters.find((param) => param.kind === 'otp');

  for (const param of info.parameters) {
    switch (param.kind) {
      case 'text':
      case 'otp':
      case 'coupon_code': {
        const value = textValue(param.key);
        if (!value) {
          missing.push(param.key);
        } else if (param.kind === 'otp' && value.length > TEMPLATE_LIMITS.otp) {
          errors[param.key] = `Codes can be up to ${TEMPLATE_LIMITS.otp} characters`;
        } else if (param.kind === 'coupon_code' && value.length > TEMPLATE_LIMITS.couponCode) {
          errors[param.key] = `Coupon codes can be up to ${TEMPLATE_LIMITS.couponCode} characters`;
        }
        break;
      }
      case 'url': {
        const value = (values.text[param.key] ?? '').trim();
        if (!value) {
          missing.push(param.key);
        } else if (resolveButtonUrl(param.url, value).length > TEMPLATE_LIMITS.url) {
          errors[param.key] = `The full link must be ${TEMPLATE_LIMITS.url} characters or fewer`;
        }
        break;
      }
      case 'media': {
        const { media } = values;
        if (media.source === 'upload') {
          if (!media.mediaId) missing.push(param.key);
        } else if (!media.link.trim()) {
          missing.push(param.key);
        } else if (!isHttpsUrl(media.link.trim())) {
          errors[param.key] = 'Enter a public https:// link';
        }
        break;
      }
      case 'location': {
        const latitude = parseCoordinate(values.location.latitude, 90);
        const longitude = parseCoordinate(values.location.longitude, 180);
        if (latitude === null) missing.push('location.latitude');
        else if (Number.isNaN(latitude)) errors['location.latitude'] = 'Latitude must be between -90 and 90';
        if (longitude === null) missing.push('location.longitude');
        else if (Number.isNaN(longitude)) errors['location.longitude'] = 'Longitude must be between -180 and 180';
        for (const field of ['name', 'address'] as const) {
          if (values.location[field].length > TEMPLATE_LIMITS.locationText) {
            errors[`location.${field}`] = `Up to ${TEMPLATE_LIMITS.locationText} characters`;
          }
        }
        break;
      }
    }
  }

  const textFor = (scope: 'header' | 'body') => (name: string) => {
    if (scope === 'body' && otp) return textValue(otp.key) || undefined;
    return textValue(`${scope}:${name}`) || undefined;
  };

  const preview: TemplatePreview = { buttons: [] };
  const headerFormat = parts.header?.format?.toUpperCase();
  if (parts.header) {
    if (!headerFormat || headerFormat === 'TEXT') {
      const segments = renderSegments(parts.header.text ?? '', textFor('header'));
      preview.header = { kind: 'text', segments, length: segmentsLength(segments) };
      if (segmentsLength(segments) > TEMPLATE_LIMITS.headerText) {
        limitIssues.push(`The header is ${segmentsLength(segments)} characters; WhatsApp allows ${TEMPLATE_LIMITS.headerText}.`);
      }
    } else if ((MEDIA_HEADER_FORMATS as string[]).includes(headerFormat)) {
      preview.header = {
        kind: 'media',
        format: headerFormat as HeaderMediaFormat,
        fileName: values.media.source === 'upload' ? values.media.fileName : values.media.link.trim().split('/').pop() || undefined,
      };
    } else if (headerFormat === 'LOCATION') {
      preview.header = {
        kind: 'location',
        name: values.location.name.trim() || undefined,
        address: values.location.address.trim() || undefined,
      };
    }
  }

  if (parts.body?.text) {
    const segments = renderSegments(parts.body.text, textFor('body'));
    const length = segmentsLength(segments);
    preview.body = { segments, length };
    if (length > TEMPLATE_LIMITS.body) {
      limitIssues.push(`The message body is ${length} characters after filling in parameters; WhatsApp allows ${TEMPLATE_LIMITS.body}.`);
    }
  }

  if (parts.footer?.text) {
    preview.footer = { text: parts.footer.text, length: parts.footer.text.length };
    if (parts.footer.text.length > TEMPLATE_LIMITS.footer) {
      limitIssues.push(`The footer is longer than ${TEMPLATE_LIMITS.footer} characters.`);
    }
  }

  preview.buttons = parts.buttons.map((button, index) => {
    const param = info.parameters.find((p) => p.kind === 'url' && p.buttonIndex === index);
    const suffix = param ? (values.text[param.key] ?? '').trim() : '';
    return {
      type: button.type?.toUpperCase() ?? '',
      text: button.text || `Button ${index + 1}`,
      url: button.url && param && suffix ? resolveButtonUrl(button.url, suffix) : button.url,
    };
  });

  const canSend = !info.unsupported && missing.length === 0 &&
    Object.keys(errors).length === 0 && limitIssues.length === 0;

  return { preview, errors, limitIssues, missing, canSend };
}

/** Turns the filled-in form into the body for POST /api/templates/send. */
export function buildTemplateSendRequest(
  template: Template,
  info: TemplateParameterInfo,
  values: TemplateFormValues,
  recipient: { to: string; phoneNumberId?: string },
): TemplateSendRequest {
  const request: TemplateSendRequest = {
    ...recipient,
    templateName: template.name,
    languageCode: template.language,
    parameterFormat: info.format,
  };
  const named = info.format === 'NAMED';
  const body: NonNullable<TemplateSendRequest['body']> = [];
  const buttons: TemplateSendButton[] = [];
  let header: TemplateSendHeader | undefined;

  for (const param of info.parameters) {
    const text = sanitizeTextParameter(values.text[param.key] ?? '');
    switch (param.kind) {
      case 'text':
        if (param.component === 'HEADER') {
          header = { type: 'text', text, ...(named && { parameterName: param.name }) };
        } else {
          body.push({ text, ...(named && { parameterName: param.name }) });
        }
        break;
      case 'otp':
        // Authentication templates are positional: the code fills {{1}}.
        body.push({ text });
        if (param.buttonIndex !== undefined) buttons.push({ subType: 'url', index: param.buttonIndex, text });
        break;
      case 'url':
        buttons.push({ subType: 'url', index: param.buttonIndex, text: encodeUrlSuffix(values.text[param.key] ?? '') });
        break;
      case 'coupon_code':
        buttons.push({ subType: 'copy_code', index: param.buttonIndex, couponCode: text });
        break;
      case 'media': {
        const type = param.format.toLowerCase() as 'image' | 'video' | 'document';
        const source = values.media.source === 'upload'
          ? { id: values.media.mediaId }
          : { link: values.media.link.trim() };
        header = type === 'document'
          ? { type, ...source, ...(values.media.source === 'upload' && values.media.fileName && { filename: values.media.fileName }) }
          : { type, ...source };
        break;
      }
      case 'location':
        header = {
          type: 'location',
          latitude: Number(values.location.latitude),
          longitude: Number(values.location.longitude),
          ...(values.location.name.trim() && { name: values.location.name.trim() }),
          ...(values.location.address.trim() && { address: values.location.address.trim() }),
        };
        break;
    }
  }

  if (header) request.header = header;
  if (body.length > 0) request.body = body;
  if (buttons.length > 0) request.buttons = buttons.sort((a, b) => a.index - b.index);
  return request;
}
