import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({ example: '2026-03-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-03-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'DAILY', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] })
  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'])
  frequency?: string;

  @ApiPropertyOptional({ example: 'csv', enum: ['json', 'csv'] })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: string;
}
