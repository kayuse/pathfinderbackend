import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '../../entities/user.entity.js';

export class CreateUserDto {
  @ApiProperty({ example: 'new.user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'strongpassword123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'New User' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.USER })
  @IsOptional()
  @IsEnum(Role)
  role?: string;
}
