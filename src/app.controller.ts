import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
@ApiTags('System')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Health/root endpoint' })
  @ApiOkResponse({ description: 'Service greeting', schema: { example: 'Hello World!' } })
  getHello(): string {
    return this.appService.getHello();
  }
}
