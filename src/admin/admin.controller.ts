import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService } from './admin.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiTags('Admin')
@ApiBearerAuth('jwt-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * List all users with optional filtering
   */
  @Get('users')
  @ApiOperation({ summary: 'List users with filtering and pagination' })
  @ApiOkResponse({ description: 'Paginated users list' })
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.listUsers({
      search: query.search,
      role: query.role,
      sessionId: query.sessionId,
      page: query.page || 1,
      limit: query.limit || 20,
    });
  }

  /**
   * Create a new user via admin
   */
  @Post('users')
  @ApiOperation({ summary: 'Create a new user (admin)' })
  @ApiBody({ type: CreateUserDto })
  @ApiOkResponse({ description: 'Created user profile' })
  createUser(@Body() createUserDto: CreateUserDto) {
    return this.adminService.createUser(createUserDto);
  }

  /**
   * Get users who logged tasks in a session (with logs)
   */
  @Get('analytics/logged-users')
  @ApiOperation({ summary: 'Get users who logged tasks in a session' })
  @ApiQuery({ name: 'sessionId', required: true, description: 'Session UUID' })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-03-31' })
  @ApiOkResponse({ description: 'Users with task logs and summary' })
  getLoggedUsers(@Query() query: AnalyticsQueryDto) {
    return this.adminService.getLoggedUsers(query.sessionId as string, query.startDate, query.endDate);
  }

  /**
   * Get users who have NOT logged tasks in a session (follow-up)
   */
  @Get('analytics/not-logged-users')
  @ApiOperation({ summary: 'Get users who have not logged tasks in a session' })
  @ApiQuery({ name: 'sessionId', required: true, description: 'Session UUID' })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-03-31' })
  @ApiOkResponse({ description: 'Users to follow up with' })
  getNotLoggedUsers(@Query() query: AnalyticsQueryDto) {
    return this.adminService.getNotLoggedUsers(query.sessionId as string, query.startDate, query.endDate);
  }

  /**
   * Get completion rate by session
   */
  @Get('analytics/completion-by-session')
  @ApiOperation({ summary: 'Get completion rate aggregated by session' })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-03-31' })
  @ApiOkResponse({ description: 'Session completion metrics' })
  getCompletionBySession(@Query() query: AnalyticsQueryDto) {
    return this.adminService.getCompletionBySession(query.startDate, query.endDate);
  }

  /**
   * Get completion rate by frequency (daily/weekly/monthly/custom)
   */
  @Get('analytics/completion-by-frequency')
  @ApiOperation({ summary: 'Get completion rate aggregated by commitment frequency' })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-03-31' })
  @ApiOkResponse({ description: 'Frequency completion metrics' })
  getCompletionByFrequency(@Query() query: AnalyticsQueryDto) {
    return this.adminService.getCompletionByFrequency(query.startDate, query.endDate);
  }

  /**
   * Export analytics as CSV
   */
  @Get('analytics/export.csv')
  @ApiOperation({ summary: 'Export analytics as CSV text payload' })
  @ApiQuery({ name: 'sessionId', required: false, description: 'Session UUID' })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-03-31' })
  @ApiOkResponse({ description: 'CSV response body', schema: { example: '"User ID","Email","Name","Log Count"' } })
  async exportAnalyticsCSV(
    @Query() query?: AnalyticsQueryDto,
  ) {
    return this.adminService.exportAnalyticsCSV(query?.sessionId, query?.startDate, query?.endDate);
  }
}
