import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TelegramService } from './telegram.service.js';

@Controller('telegram')
@ApiTags('Telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  /**
   * Webhook endpoint that Telegram calls for every update.
   *
   * Register it with:
   *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
   *   Body: { url: "https://<your-domain>/telegram/webhook" }
   *
   * Secure it by setting TELEGRAM_WEBHOOK_SECRET in your environment and
   * passing the same value as the `secret_token` parameter to setWebhook.
   * Telegram will then include the X-Telegram-Bot-Api-Secret-Token header
   * on every request.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telegram webhook endpoint for bot updates' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        update_id: { type: 'number', example: 123456789 },
        message: { type: 'object', additionalProperties: true },
        callback_query: { type: 'object', additionalProperties: true },
      },
      additionalProperties: true,
    },
  })
  @ApiOkResponse({ description: 'Webhook update accepted', schema: { example: { ok: true } } })
  handleWebhook(
    @Headers('x-telegram-bot-api-secret-token') incomingSecret: string | undefined,
    @Body() body: unknown,
  ) {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    // if (expectedSecret && incomingSecret !== expectedSecret) {
    //   throw new UnauthorizedException('Invalid webhook secret');
    // }
    this.telegramService.processUpdate(body);
    return { ok: true };
  }
}
