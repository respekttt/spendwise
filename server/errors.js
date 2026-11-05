// Формат помилок HTTP (контракт API, «Загальні правила»).
// Тіло будь-якої помилки — рівно `{ "error": "<рядок українською>" }`, `Content-Type: application/json`.
// Модуль належить до HTTP-шару: його імпортують `app.js` і `server/routes/`, але не `server/core/`.

/** Усі тексти помилок, що можуть потрапити у відповідь. */
export const MESSAGES = Object.freeze({
  invalidRequest: 'Невалідні дані запиту',
  resourceNotFound: 'Ресурс не знайдено',
  routeNotFound: 'Маршрут не знайдено',
  internal: 'Внутрішня помилка сервера',
  clientErrorFallback: 'Некоректний запит',
});

/** Тексти для `4xx`, які може повернути сам Fastify. Решта `4xx` — `clientErrorFallback`. */
const CLIENT_ERROR_MESSAGES = Object.freeze({
  400: MESSAGES.clientErrorFallback,
  404: MESSAGES.resourceNotFound,
  405: 'Метод не підтримується',
  406: 'Неприйнятний формат відповіді',
  408: 'Час очікування запиту вичерпано',
  413: 'Тіло запиту завелике',
  414: 'Адреса запиту задовга',
  415: 'Непідтримуваний тип вмісту (Content-Type)',
  431: 'Заголовки запиту завеликі',
});

// Помилки розбору JSON-тіла: контракт прирівнює їх до помилок схеми.
const INVALID_JSON_CODES = new Set([
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
]);

/**
 * Помилка застосунку з кодом `4xx` і **публічним** текстом, який віддається клієнту як є.
 * Кидається з маршрутів, наприклад `throw new HttpError(400, 'amount: сума має бути більшою за 0')`.
 */
export class HttpError extends Error {
  /**
   * @param {number} statusCode код `400`–`499`
   * @param {string} [message] текст українською; за замовчуванням — типовий для коду
   */
  constructor(statusCode, message) {
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 499) {
      throw new TypeError(`HttpError: очікується код 4xx, отримано ${statusCode}`);
    }
    super(message || clientErrorMessage(statusCode));
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

/** @param {number} statusCode */
function clientErrorMessage(statusCode) {
  return CLIENT_ERROR_MESSAGES[statusCode] ?? MESSAGES.clientErrorFallback;
}

/**
 * Перетворює будь-яку помилку на код і публічний текст.
 * `null` означає неочікувану помилку (`500`).
 * @param {any} error
 * @returns {{ status: number, message: string } | null}
 */
function toClientError(error) {
  if (error instanceof HttpError) {
    return { status: error.statusCode, message: error.message };
  }
  if (error?.validation) {
    // Нечисловий або недодатний :id — 404, а не 400 (контракт, «Загальні правила»).
    if (error.validationContext === 'params') {
      return { status: 404, message: MESSAGES.resourceNotFound };
    }
    return { status: 400, message: MESSAGES.invalidRequest };
  }
  if (INVALID_JSON_CODES.has(error?.code)) {
    return { status: 400, message: MESSAGES.invalidRequest };
  }
  const status = error?.statusCode;
  // Інші 4xx (переважно від Fastify): свій код, але власний текст — англійське повідомлення не віддаємо.
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { status, message: clientErrorMessage(status) };
  }
  // Без statusCode, >= 500 або < 400 (кинута помилка з «успішним» кодом — теж збій): 500.
  return null;
}

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {number} status
 * @param {string} message
 */
function sendError(reply, status, message) {
  // Тип задається явно: маршрут міг виставити інший до того, як кинув помилку.
  return reply.code(status).type('application/json; charset=utf-8').send({ error: message });
}

/**
 * Реєструє `setErrorHandler` і `setNotFoundHandler` — єдине місце формування тіла помилки.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerErrorHandlers(app) {
  app.setErrorHandler((error, request, reply) => {
    const clientError = toClientError(error);
    if (clientError) {
      return sendError(reply, clientError.status, clientError.message);
    }
    request.log.error({ err: error }, 'Неочікувана помилка під час обробки запиту');
    return sendError(reply, 500, MESSAGES.internal);
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, MESSAGES.routeNotFound));
}
