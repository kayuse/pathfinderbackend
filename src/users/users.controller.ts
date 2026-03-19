import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { User } from '../entities/user.entity.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiTags('Users')
@ApiBearerAuth('jwt-auth')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiOkResponse({
    description: 'User profile with recent logs and session participation',
    schema: {
      example: {
        id: 'b41e9a59-f1ed-42cf-afc9-00d68a5d7df4',
        email: 'user@example.com',
        name: 'John Doe',
        role: 'USER',
        sessions: [],
        logs: [],
      },
    },
  })
  getProfile(@CurrentUser() user: User) {
    return this.usersService.getUserProfile(user.id);
  }
}
