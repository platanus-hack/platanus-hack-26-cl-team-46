import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('admin')
export class AdminController {
  @Get('stats')
  stats() {
    return this.admin.stats();
  }
}
