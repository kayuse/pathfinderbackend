import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../entities/user.entity.js';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Partial<User> => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
