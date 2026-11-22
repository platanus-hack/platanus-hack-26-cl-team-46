import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  @Post('signin')
  signin(@Body() body: { username: string; password: string }) {
    return this.auth.signin(body.username, body.password);
  }

  @Post('signup')
  signup(@Body() body: Record<string, unknown>) {
    return this.users.create(body);
  }

  @UseGuards(JwtGuard)
  @Get('profile')
  profile(@Req() req: { user: unknown }) {
    return req.user;
  }
}
