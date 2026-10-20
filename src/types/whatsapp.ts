// Template shapes as the SDK returns them: response keys are camelCased deeply
// (`phone_number` -> `phoneNumber`, `parameter_format` -> `parameterFormat`).

export type TemplateButton = {
  /** QUICK_REPLY, URL, PHONE_NUMBER, COPY_CODE, OTP, FLOW, CATALOG, MPM, SPM, VOICE_CALL, ... */
  type: string;
  text?: string;
  url?: string;
  phoneNumber?: string;
  /** URL buttons: an array with a full example URL. COPY_CODE buttons: the example code (string or array). */
  example?: string[] | string;
  /** OTP buttons on authentication templates: COPY_CODE, ONE_TAP or ZERO_TAP. */
  otpType?: string;
  flowId?: string;
  flowAction?: string;
};

export type TemplateNamedParamExample = {
  paramName: string;
  example: string;
};

export type TemplateComponentExample = {
  headerText?: string[];
  headerHandle?: string[];
  bodyText?: string[][];
  bodyTextNamedParams?: TemplateNamedParamExample[];
  headerTextNamedParams?: TemplateNamedParamExample[];
};

export type TemplateComponent = {
  /** HEADER, BODY, FOOTER, BUTTONS, CAROUSEL, LIMITED_TIME_OFFER, ... */
  type: string;
  /** HEADER only: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION or PRODUCT. */
  format?: string;
  text?: string;
  example?: TemplateComponentExample;
  buttons?: TemplateButton[];
  /** Authentication templates. */
  addSecurityRecommendation?: boolean;
  codeExpirationMinutes?: number;
};

export type Template = {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  /** NAMED or POSITIONAL. Returned by the Graph API for templates created with `parameter_format`. */
  parameterFormat?: string;
  components?: TemplateComponent[];
};

export type ParameterFormat = 'POSITIONAL' | 'NAMED';

export type HeaderMediaFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

type ParameterBase = {
  /** Unique key for form state. */
  key: string;
  /** Human-readable label. */
  label: string;
  example?: string;
};

/** A `{{1}}` / `{{name}}` placeholder in the header or body text. */
export type TemplateTextParameter = ParameterBase & {
  kind: 'text';
  component: 'HEADER' | 'BODY';
  /** Placeholder name: `1`, `2` for positional templates, the param name for named ones. */
  name: string;
};

/** IMAGE / VIDEO / DOCUMENT header: needs a media ID or a public link. */
export type TemplateMediaHeaderParameter = ParameterBase & {
  kind: 'media';
  component: 'HEADER';
  format: HeaderMediaFormat;
};

/** LOCATION header: needs coordinates at send time. */
export type TemplateLocationHeaderParameter = ParameterBase & {
  kind: 'location';
  component: 'HEADER';
};

/** URL button whose URL ends in `{{1}}`: only the variable suffix is sent. */
export type TemplateUrlButtonParameter = ParameterBase & {
  kind: 'url';
  component: 'BUTTON';
  buttonIndex: number;
  buttonText: string;
  /** The template's URL including the `{{1}}` placeholder. */
  url: string;
};

/** COPY_CODE (coupon) button. */
export type TemplateCouponParameter = ParameterBase & {
  kind: 'coupon_code';
  component: 'BUTTON';
  buttonIndex: number;
  buttonText: string;
};

/** Authentication one-time password: goes in the body `{{1}}` and in the OTP (URL) button. */
export type TemplateOtpParameter = ParameterBase & {
  kind: 'otp';
  component: 'BODY';
  /** Index of the OTP button, when the template has one. */
  buttonIndex?: number;
};

export type TemplateParameter =
  | TemplateTextParameter
  | TemplateMediaHeaderParameter
  | TemplateLocationHeaderParameter
  | TemplateUrlButtonParameter
  | TemplateCouponParameter
  | TemplateOtpParameter;

export type TemplateParameterInfo = {
  format: ParameterFormat;
  parameters: TemplateParameter[];
  /** Set when the template uses components this inbox can't fill in (carousel, catalog, ...). */
  unsupported?: string;
};

// ---- Request body for POST /api/templates/send ----

export type TemplateSendHeader =
  | { type: 'text'; text: string; parameterName?: string }
  | { type: 'image' | 'video'; id?: string; link?: string }
  | { type: 'document'; id?: string; link?: string; filename?: string }
  | { type: 'location'; latitude: number; longitude: number; name?: string; address?: string };

export type TemplateSendButton =
  | { subType: 'url'; index: number; text: string }
  | { subType: 'copy_code'; index: number; couponCode: string }
  | { subType: 'flow'; index: number; flowToken?: string };

export type TemplateSendRequest = {
  to: string;
  phoneNumberId?: string;
  templateName: string;
  languageCode: string;
  parameterFormat: ParameterFormat;
  header?: TemplateSendHeader;
  body?: Array<{ text: string; parameterName?: string }>;
  buttons?: TemplateSendButton[];
};
