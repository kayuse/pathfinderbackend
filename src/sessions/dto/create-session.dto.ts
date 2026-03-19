import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ example: 'Morning Prayer Challenge' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Prayer and consistency' })
  @IsOptional()
  @IsString()
  spiritualFocus?: string;

  @ApiPropertyOptional({ example: 'A 30-day group challenge focused on daily prayer.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  openForApplication?: boolean;

  @ApiProperty({ example: '2026-03-20T00:00:00.000Z', format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  startDate: Date | string;

  @ApiProperty({ example: '2026-04-20T00:00:00.000Z', format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  endDate: Date | string;
}
