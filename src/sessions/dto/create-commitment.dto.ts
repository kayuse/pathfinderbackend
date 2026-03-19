import { Frequency } from '../../entities/commitment.entity.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCommitmentDto {
  @ApiProperty({ example: 'Pray for 15 minutes' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Focus on gratitude and intercession.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: Frequency, example: Frequency.DAILY })
  @IsEnum(Frequency)
  frequency: Frequency;

  @ApiPropertyOptional({ example: 15, description: 'Optional target value for measurable commitments.' })
  @IsOptional()
  @IsNumber()
  targetValue?: number;
}
