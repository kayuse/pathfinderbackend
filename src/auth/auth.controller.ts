import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user with email/password' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'User registered successfully',
    schema: {
      example: {
        access_token: 'jwt-token',
        user: {
          id: 'b41e9a59-f1ed-42cf-afc9-00d68a5d7df4',
          email: 'user@example.com',
          name: 'John Doe',
          role: 'ADMIN',
        },
      },
    },
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/password and get JWT token' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Login successful',
    schema: {
      example: {
        access_token: 'jwt-token',
        user: {
          id: 'b41e9a59-f1ed-42cf-afc9-00d68a5d7df4',
          email: 'user@example.com',
          name: 'John Doe',
          role: 'USER',
        },
      },
    },
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('telegram/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Telegram Login Widget payload' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['id', 'auth_date', 'hash'],
      properties: {
        id: { type: 'number', example: 123456789 },
        first_name: { type: 'string', example: 'John' },
        last_name: { type: 'string', example: 'Doe' },
        username: { type: 'string', example: 'johndoe' },
        auth_date: { type: 'number', example: 1711111111 },
        hash: { type: 'string', example: 'telegram-signature-hash' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Telegram login successful',
    schema: {
      example: {
        access_token: 'jwt-token',
        user: {
          id: 'b41e9a59-f1ed-42cf-afc9-00d68a5d7df4',
          telegramId: '123456789',
          telegramUsername: 'johndoe',
          name: 'John Doe',
          role: 'USER',
        },
      },
    },
  })
  async telegramLogin(@Body() telegramData: any) {
    return this.authService.loginWithTelegram(telegramData);
  }
}
