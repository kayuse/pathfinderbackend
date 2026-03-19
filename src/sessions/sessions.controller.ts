import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SessionsService } from './sessions.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { CreateCommitmentDto } from './dto/create-commitment.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { User } from '../entities/user.entity.js';
import { LogStatus } from '../entities/commitment-log.entity.js';

@Controller('sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('Sessions')
@ApiBearerAuth('jwt-auth')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) { }

  @Post('create')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a new session (admin only)' })
  @ApiBody({ type: CreateSessionDto })
  @ApiCreatedResponse({ description: 'Session created' })
  create(@Body() createSessionDto: CreateSessionDto) {
    return this.sessionsService.createSession(createSessionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all sessions' })
  @ApiOkResponse({ description: 'List of sessions with commitments' })
  findAll() {
    return this.sessionsService.findAll();
  }

  @Get('discover')
  @ApiOperation({ summary: 'Get discoverable sessions' })
  @ApiOkResponse({ description: 'Sessions that are running or open for application' })
  discoverSessions() {
    return this.sessionsService.findDiscoverableSessions();
  }

  @Get('me/today')
  @ApiOperation({ summary: 'Get authenticated user tasks for a specific date' })
  @ApiQuery({ name: 'date', required: false, example: '2026-03-19' })
  @ApiOkResponse({ description: 'Date, tasks and completion rate for the user' })
  getMyTodayTasks(@CurrentUser() user: User, @Query('date') date?: string) {
    return this.sessionsService.getUserTodayTasks(user.id, date);
  }

  @Post('me/tasks/:commitmentId/complete')
  @ApiOperation({ summary: 'Mark a task commitment as completed for today' })
  @ApiParam({ name: 'commitmentId', description: 'Commitment UUID' })
  @ApiOkResponse({ description: 'Commitment log saved or updated' })
  markTaskCompleted(
    @CurrentUser() user: User,
    @Param('commitmentId') commitmentId: string,
  ) {
    return this.sessionsService.upsertTaskLog(user.id, commitmentId, LogStatus.COMPLETED);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one session by ID' })
  @ApiParam({ name: 'id', description: 'Session UUID' })
  @ApiOkResponse({ description: 'Session details including commitments and participants' })
  findOne(@Param('id') id: string) {
    return this.sessionsService.findOne(id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a session (admin only)' })
  @ApiParam({ name: 'id', description: 'Session UUID' })
  @ApiOkResponse({ description: 'Deleted session object' })
  remove(@Param('id') id: string) {
    return this.sessionsService.remove(id);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Join a session' })
  @ApiParam({ name: 'id', description: 'Session UUID' })
  @ApiCreatedResponse({ description: 'Participant created with onboarding roadmap' })
  joinSession(
    @Param('id') sessionId: string,
    @CurrentUser() user: User,
  ) {
    return this.sessionsService.joinSession(sessionId, user.id);
  }

  @Get(':id/roadmap')
  @ApiOperation({ summary: 'Get roadmap summary grouped by frequency' })
  @ApiParam({ name: 'id', description: 'Session UUID' })
  @ApiOkResponse({ description: 'Roadmap grouped into daily/weekly/monthly/custom' })
  getRoadmap(@Param('id') sessionId: string) {
    return this.sessionsService.getRoadmapSummary(sessionId);
  }

  @Post(':id/commitments')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a commitment for a session (admin only)' })
  @ApiParam({ name: 'id', description: 'Session UUID' })
  @ApiBody({ type: CreateCommitmentDto })
  @ApiCreatedResponse({ description: 'Commitment created' })
  createCommitment(
    @Param('id') sessionId: string,
    @Body() commitmentData: CreateCommitmentDto,
  ) {
    return this.sessionsService.createCommitment(sessionId, commitmentData);
  }
}
