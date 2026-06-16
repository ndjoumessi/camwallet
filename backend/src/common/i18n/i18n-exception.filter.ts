import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { resolveLang, translateMessage } from './i18n.util';

/**
 * Filtre d'exceptions global qui traduit les messages d'erreur selon le header
 * `Accept-Language` du client (FR par défaut, EN si demandé).
 *
 * Il intercepte toutes les exceptions :
 *  - les `HttpException` conservent leur statut/forme, seul le `message` est traduit
 *    (string ou tableau de strings issu de la ValidationPipe) ;
 *  - les autres erreurs deviennent un 500 générique (lui aussi traduit).
 */
@Catch()
export class I18nExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const lang = resolveLang(request.headers['accept-language']);

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttp) {
      // Erreur non maîtrisée : on logue la stack mais on ne fuite rien au client.
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
      response.status(status).json({
        statusCode: status,
        message: translateMessage('Erreur interne du serveur', lang),
        error: 'Internal Server Error',
      });
      return;
    }

    const res = exception.getResponse();

    // getResponse() renvoie soit une string, soit un objet { statusCode, message, error }.
    let body: Record<string, any>;
    if (typeof res === 'string') {
      body = { statusCode: status, message: translateMessage(res, lang) };
    } else {
      body = { ...(res as Record<string, any>) };
      const msg = body.message;
      if (typeof msg === 'string') {
        body.message = translateMessage(msg, lang);
      } else if (Array.isArray(msg)) {
        body.message = msg.map((m) => (typeof m === 'string' ? translateMessage(m, lang) : m));
      }
    }

    response.status(status).json(body);
  }
}
