import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, Role } from '../entities/user.entity.js';
import { createHmac } from 'crypto';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) { }

  /**
   * Validates the data received from the Telegram Login Widget
   */
  validateTelegramData(data: any): boolean {
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(process.env.TELEGRAM_BOT_TOKEN || '')
      .digest();

    const dataCheckString = Object.keys(data)
      .filter((key) => key !== 'hash')
      .sort()
      .map((key) => `${key}=${data[key]}`)
      .join('\n');

    const hash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return hash === data.hash;
  }

  /**
   * Process a successful Telegram login, finding or creating the user
   */
  async loginWithTelegram(telegramUserData: any) {
    if (!this.validateTelegramData(telegramUserData)) {
      throw new UnauthorizedException('Invalid Telegram authentication data');
    }

    let user = await this.userRepository.findOne({
      where: { telegramId: telegramUserData.id.toString() },
    });

    if (!user) {
      user = this.userRepository.create({
        telegramId: telegramUserData.id.toString(),
        telegramUsername: telegramUserData.username,
        name: [telegramUserData.first_name, telegramUserData.last_name]
          .filter(Boolean)
          .join(' '),
        role: Role.USER,
      });
      user = await this.userRepository.save(user);
    }

    const payload = { sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user,
    };
  }

  /**
   * Register a new user with email and password
   */
  async register(registerDto: RegisterDto) {
    const { email, password, name, role } = registerDto;

    // Validate email format
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email address is required');
    }

    // Validate password length
    if (!password || password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('Email is already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = this.userRepository.create({
      email,
      passwordHash,
      name: name || email.split('@')[0],
      role: role || Role.USER,
    });

    await this.userRepository.save(user);

    const payload = { sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * Login with email and password
   */
  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = { sub: user.id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}
