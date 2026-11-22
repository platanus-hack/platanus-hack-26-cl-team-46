import { Controller, Get, Query } from '@nestjs/common';

@Controller('products')
export class ProductsController {
  @Get()
  search(@Query('search') search = '') {
    return this.db.query(`SELECT * FROM products WHERE name ILIKE '%${search}%'`);
  }
}
