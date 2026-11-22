import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';

@UseGuards(JwtGuard)
@Controller('orders')
export class OrdersController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(+id);
  }
}
